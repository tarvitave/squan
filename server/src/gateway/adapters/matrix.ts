/**
 * Matrix Client-Server API Adapter
 *
 * Connects via the /sync long-poll loop to receive events.
 * Sends messages via the Matrix Client-Server REST API.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'

const MATRIX_CLIENT_PREFIX = '/_matrix/client/v3'

export class MatrixAdapter implements PlatformAdapter {
  readonly platform = 'matrix' as const
  status: AdapterStatus = 'disconnected'

  private homeserverUrl = ''
  private accessToken = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Sync state
  private syncAbort: AbortController | null = null
  private nextBatch = ''
  private userId = ''
  private txnCounter = 0
  private reconnecting = false

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.homeserverUrl = (config.credentials.homeserver_url ?? '').replace(/\/+$/, '')
    this.accessToken = config.credentials.access_token

    if (!this.homeserverUrl) throw new Error('Matrix adapter requires homeserver_url credential')
    if (!this.accessToken) throw new Error('Matrix adapter requires access_token credential')

    this.status = 'connecting'

    try {
      // Verify credentials and get user ID
      const whoami = await this.apiCall<{ user_id: string }>('GET', '/account/whoami')
      this.userId = whoami.user_id
      console.log(`[Matrix] Connected as ${this.userId}`)

      this.status = 'connected'
      this.startSync()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Matrix] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false
    this.syncAbort?.abort()
    this.syncAbort = null
    this.status = 'disconnected'
    console.log('[Matrix] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const txnId = `squan_${Date.now()}_${this.txnCounter++}`
    const content = this.buildMessageContent(message)

    const result = await this.apiCall<{ event_id: string }>(
      'PUT',
      `/rooms/${encodeURIComponent(channelId)}/send/m.room.message/${txnId}`,
      content,
    )

    return result.event_id
  }

  async edit(messageId: string, channelId: string, message: OutgoingMessage): Promise<void> {
    const txnId = `squan_edit_${Date.now()}_${this.txnCounter++}`
    const newContent = this.buildMessageContent(message)

    const content = {
      'm.new_content': newContent,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: messageId,
      },
      msgtype: 'm.text',
      body: `* ${message.text}`,
    }

    await this.apiCall(
      'PUT',
      `/rooms/${encodeURIComponent(channelId)}/send/m.room.message/${txnId}`,
      content,
    )
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    const txnId = `squan_react_${Date.now()}_${this.txnCounter++}`
    const content = {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: messageId,
        key: emoji,
      },
    }

    await this.apiCall(
      'PUT',
      `/rooms/${encodeURIComponent(channelId)}/send/m.reaction/${txnId}`,
      content,
    )
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Matrix',
      description: 'Matrix Client-Server API adapter using /sync long-polling',
      requiredCredentials: ['homeserver_url', 'access_token'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Sync Loop ────────────────────────────────────────────────

  private startSync(): void {
    this.syncAbort = new AbortController()
    this.syncLoop()
  }

  private async syncLoop(): Promise<void> {
    while (this.syncAbort && !this.syncAbort.signal.aborted) {
      try {
        const params = new URLSearchParams({
          timeout: '30000',
        })

        if (this.nextBatch) {
          params.set('since', this.nextBatch)
        } else {
          // On first sync, only get a small amount of history
          params.set('filter', JSON.stringify({
            room: {
              timeline: { limit: 1 },
              state: { lazy_load_members: true },
            },
          }))
        }

        const response = await this.apiCall<SyncResponse>(
          'GET',
          `/sync?${params.toString()}`,
          undefined,
          this.syncAbort.signal,
        )

        const isInitialSync = !this.nextBatch
        this.nextBatch = response.next_batch

        // Don't process events from the initial sync (they're historical)
        if (!isInitialSync) {
          await this.processSyncResponse(response)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error(`[Matrix] Sync error: ${(err as Error).message}`)

        // Back off before retrying
        await sleep(5000)

        if (this.status !== 'disconnected' && !this.reconnecting) {
          this.reconnecting = true
          this.status = 'connecting'
          console.log('[Matrix] Attempting to resume sync...')
        }
      }
    }
  }

  private async processSyncResponse(response: SyncResponse): Promise<void> {
    // Handle room invites — auto-join
    const invitedRooms = response.rooms?.invite ?? {}
    for (const roomId of Object.keys(invitedRooms)) {
      console.log(`[Matrix] Invited to ${roomId}, auto-joining...`)
      try {
        await this.apiCall('POST', `/rooms/${encodeURIComponent(roomId)}/join`)
      } catch (err) {
        console.error(`[Matrix] Failed to join ${roomId}: ${(err as Error).message}`)
      }
    }

    // Handle room timeline events
    const joinedRooms = response.rooms?.join ?? {}
    for (const [roomId, roomData] of Object.entries(joinedRooms)) {
      const events = roomData.timeline?.events ?? []
      for (const event of events) {
        if (event.type === 'm.room.message') {
          await this.handleRoomMessage(roomId, event)
        }
      }
    }

    // Reconnect status recovery
    if (this.reconnecting) {
      this.reconnecting = false
      this.status = 'connected'
      console.log('[Matrix] Sync resumed')
    }
  }

  private async handleRoomMessage(roomId: string, event: MatrixEvent): Promise<void> {
    // Ignore our own messages
    if (event.sender === this.userId) return

    const content = event.content as {
      msgtype?: string
      body?: string
      'm.relates_to'?: { rel_type?: string }
    }

    // Ignore non-text messages and edits (they have m.relates_to with m.replace)
    if (content.msgtype !== 'm.text') return
    if (content['m.relates_to']?.rel_type === 'm.replace') return

    const text = content.body ?? ''
    if (!text) return

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(event.sender ?? '')) return

    // Check for mentions
    let messageText = text
    const mentionPattern = new RegExp(`${escapeRegex(this.userId)}\\s*`, 'g')
    messageText = messageText.replace(mentionPattern, '').trim()

    // Also handle display name mentions
    const localpart = this.userId.split(':')[0]?.slice(1) ?? ''
    if (localpart) {
      const displayMention = new RegExp(`@?${escapeRegex(localpart)}\\s*`, 'gi')
      messageText = messageText.replace(displayMention, '').trim()
    }

    const incoming: IncomingMessage = {
      platform: 'matrix',
      platformUserId: event.sender ?? '',
      platformUserName: extractLocalpart(event.sender ?? ''),
      channelId: roomId,
      messageId: event.event_id ?? '',
      text: messageText || text, // Fall back to original if stripping emptied it
      timestamp: new Date(event.origin_server_ts ?? 0),
      raw: event,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[Matrix] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private buildMessageContent(message: OutgoingMessage): Record<string, unknown> {
    const content: Record<string, unknown> = {
      msgtype: 'm.text',
      body: message.text,
    }

    if (message.format === 'markdown' || message.format === 'html') {
      content.format = 'org.matrix.custom.html'
      content.formatted_body = message.format === 'html'
        ? message.text
        : simpleMarkdownToHtml(message.text)
    }

    return content
  }

  private async apiCall<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.homeserverUrl}${MATRIX_CLIENT_PREFIX}${path}`
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      signal,
    }
    if (body) {
      opts.body = JSON.stringify(body)
    }

    const res = await fetch(url, opts)

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Matrix API ${method} ${path}: ${res.status} ${text}`)
    }

    // Some endpoints may return empty body
    const text = await res.text()
    if (!text) return {} as T
    return JSON.parse(text) as T
  }
}

// ── Utilities ────────────────────────────────────────────────────

function extractLocalpart(userId: string): string {
  // @user:server.com → user
  const match = userId.match(/^@([^:]+)/)
  return match?.[1] ?? userId
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function simpleMarkdownToHtml(text: string): string {
  let html = text
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  // Line breaks
  html = html.replace(/\n/g, '<br>')
  return html
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Matrix-specific types ────────────────────────────────────────

interface SyncResponse {
  next_batch: string
  rooms?: {
    join?: Record<string, {
      timeline?: { events: MatrixEvent[] }
    }>
    invite?: Record<string, unknown>
  }
}

interface MatrixEvent {
  type: string
  event_id?: string
  sender?: string
  origin_server_ts?: number
  content: unknown
}
