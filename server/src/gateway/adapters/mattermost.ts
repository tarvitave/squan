/**
 * Mattermost Adapter
 *
 * Connects via the Mattermost REST API v4 and WebSocket for real-time events.
 * Sends messages via POST /api/v4/posts with thread support via root_id.
 * Uses the 'ws' package for WebSocket connectivity.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'
import WebSocket from 'ws'

const MAX_MESSAGE_LENGTH = 16383

export class MattermostAdapter implements PlatformAdapter {
  readonly platform = 'mattermost' as const
  status: AdapterStatus = 'disconnected'

  private serverUrl = ''
  private accessToken = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // WebSocket state
  private ws: WebSocket | null = null
  private botUserId = ''
  private seqNumber = 1
  private reconnecting = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.serverUrl = (config.credentials.server_url ?? '').replace(/\/$/, '')
    this.accessToken = config.credentials.access_token ?? ''

    if (!this.serverUrl) throw new Error('Mattermost adapter requires server_url credential')
    if (!this.accessToken) throw new Error('Mattermost adapter requires access_token credential')

    this.status = 'connecting'

    try {
      // Verify token by fetching current user
      const me = await this.apiCall<{ id: string; username: string }>('GET', '/api/v4/users/me')
      this.botUserId = me.id
      console.log(`[Mattermost] Authenticated as @${me.username} (${me.id})`)

      await this.connectWebSocket()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Mattermost] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    if (this.ws) {
      this.ws.close(1000, 'Disconnect requested')
      this.ws = null
    }
    this.status = 'disconnected'
    console.log('[Mattermost] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = this.formatOutgoing(message)
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastPostId = ''

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        channel_id: channelId,
        message: chunk,
      }
      if (message.replyTo) {
        body.root_id = message.replyTo
      }

      const result = await this.apiCall<{ id: string }>('POST', '/api/v4/posts', body)
      lastPostId = result.id
    }

    return lastPostId
  }

  async edit(messageId: string, _channelId: string, message: OutgoingMessage): Promise<void> {
    const text = this.formatOutgoing(message)
    await this.apiCall('PUT', `/api/v4/posts/${messageId}/patch`, {
      message: text.slice(0, MAX_MESSAGE_LENGTH),
    })
  }

  async react(messageId: string, _channelId: string, emoji: string): Promise<void> {
    await this.apiCall('POST', '/api/v4/reactions', {
      user_id: this.botUserId,
      post_id: messageId,
      emoji_name: emoji.replace(/:/g, ''),
    })
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Mattermost',
      description: 'Mattermost adapter using REST API v4 and WebSocket events',
      requiredCredentials: ['server_url', 'access_token'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── WebSocket ────────────────────────────────────────────────

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Convert http(s) to ws(s) URL
      const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/api/v4/websocket'
      this.ws = new WebSocket(wsUrl)
      let resolved = false

      this.ws.on('open', () => {
        console.log('[Mattermost] WebSocket opened')
        // Authenticate via the WebSocket
        this.wsSend({
          seq: this.seqNumber++,
          action: 'authentication_challenge',
          data: { token: this.accessToken },
        })
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        const payload = JSON.parse(data.toString()) as MattermostWSEvent

        // Handle auth response
        if (payload.seq_reply !== undefined && !resolved) {
          if (payload.status === 'OK') {
            this.status = 'connected'
            this.reconnecting = false
            resolved = true
            this.startPing()
            resolve()
          } else {
            resolved = true
            reject(new Error(`WebSocket auth failed: ${JSON.stringify(payload.error)}`))
          }
          return
        }

        // Handle events
        if (payload.event) {
          this.handleWSEvent(payload)
        }
      })

      this.ws.on('close', (code, reason) => {
        console.log(`[Mattermost] WebSocket closed: ${code} ${reason.toString()}`)
        this.stopPing()
        if (!resolved) {
          resolved = true
          reject(new Error(`WebSocket closed during connect: ${code}`))
          return
        }
        if (this.status !== 'disconnected' && !this.reconnecting) {
          this.scheduleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        console.error(`[Mattermost] WebSocket error: ${err.message}`)
        if (!resolved) {
          resolved = true
          reject(err)
        }
      })
    })
  }

  private handleWSEvent(event: MattermostWSEvent): void {
    switch (event.event) {
      case 'posted': {
        const postData = typeof event.data?.post === 'string'
          ? JSON.parse(event.data.post) as MattermostPost
          : event.data?.post as MattermostPost | undefined

        if (postData) {
          this.handlePost(postData, event.data).catch((err) =>
            console.error(`[Mattermost] Message handler error: ${(err as Error).message}`),
          )
        }
        break
      }
      case 'hello':
        console.log('[Mattermost] WebSocket hello received')
        break
    }
  }

  private async handlePost(post: MattermostPost, eventData?: Record<string, unknown>): Promise<void> {
    // Ignore own messages
    if (post.user_id === this.botUserId) return
    // Ignore system messages
    if (post.type && post.type !== '') return

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(post.user_id)) return

    // Resolve username from event data or fallback
    const senderName = (eventData?.sender_name as string)?.replace(/^@/, '') ?? post.user_id

    const incoming: IncomingMessage = {
      platform: 'mattermost',
      platformUserId: post.user_id,
      platformUserName: senderName,
      channelId: post.channel_id,
      messageId: post.id,
      text: post.message,
      replyTo: post.root_id || undefined,
      timestamp: new Date(post.create_at),
      raw: post,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[Mattermost] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Ping / Keepalive ─────────────────────────────────────────

  private startPing(): void {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.wsSend({ seq: this.seqNumber++, action: 'ping' })
      }
    }, 30000)
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  // ── Reconnection ─────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.reconnecting = true
    this.status = 'connecting'
    const delay = 5000 + Math.random() * 5000
    console.log(`[Mattermost] Reconnecting in ${Math.round(delay)}ms...`)
    this.reconnectTimer = setTimeout(() => {
      if (this.reconnecting) {
        this.connectWebSocket().catch((err) => {
          console.error(`[Mattermost] Reconnect failed: ${(err as Error).message}`)
          this.scheduleReconnect()
        })
      }
    }, delay)
  }

  // ── Helpers ──────────────────────────────────────────────────

  private wsSend(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private formatOutgoing(message: OutgoingMessage): string {
    // Mattermost natively supports Markdown
    return message.text
  }

  private async apiCall<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Mattermost API ${method} ${path}: ${res.status} ${text}`)
    }

    if (res.status === 204) return undefined as unknown as T
    return (await res.json()) as T
  }
}

// ── Utilities ────────────────────────────────────────────────────

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen)
    if (splitIdx < maxLen * 0.3) splitIdx = remaining.lastIndexOf(' ', maxLen)
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen
    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }
  return chunks
}

// ── Mattermost-specific types ────────────────────────────────────

interface MattermostWSEvent {
  event?: string
  data?: Record<string, unknown>
  seq_reply?: number
  status?: string
  error?: unknown
}

interface MattermostPost {
  id: string
  channel_id: string
  user_id: string
  root_id: string
  message: string
  type: string
  create_at: number
}
