/**
 * iMessage Adapter (via BlueBubbles)
 *
 * Uses the BlueBubbles REST API (runs on a Mac host) to send and receive
 * iMessages. Polls /api/v1/message for incoming messages and sends via
 * /api/v1/message/text.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
  Attachment,
} from '../types'

const MAX_MESSAGE_LENGTH = 20000

export class IMessageAdapter implements PlatformAdapter {
  readonly platform = 'imessage' as const
  status: AdapterStatus = 'disconnected'

  private serverUrl = ''
  private password = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private pollingAbort: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Track last message timestamp for polling
  private lastMessageDate = 0
  private processedGuids = new Set<string>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.serverUrl = (config.credentials.server_url ?? '').replace(/\/$/, '')
    this.password = config.credentials.password ?? ''

    if (!this.serverUrl) throw new Error('iMessage adapter requires server_url credential')
    if (!this.password) throw new Error('iMessage adapter requires password credential')

    this.status = 'connecting'

    try {
      // Verify the BlueBubbles server is reachable
      const res = await fetch(`${this.serverUrl}/api/v1/server/info?password=${encodeURIComponent(this.password)}`)

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`BlueBubbles server not reachable: ${res.status} ${errText}`)
      }

      const info = (await res.json()) as { status: number; data?: { os_version?: string; server_version?: string } }
      console.log(`[iMessage] Connected to BlueBubbles v${info.data?.server_version ?? 'unknown'} on macOS ${info.data?.os_version ?? 'unknown'}`)

      this.lastMessageDate = Date.now() - 5000 // Start from ~5s ago
      this.status = 'connected'
      this.startPolling()

      // Periodic cleanup of processed GUID cache
      this.cleanupInterval = setInterval(() => {
        this.processedGuids.clear()
      }, 30 * 60 * 1000) // Clear every 30 minutes
    } catch (err) {
      this.status = 'error'
      throw new Error(`[iMessage] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.processedGuids.clear()
    this.status = 'disconnected'
    console.log('[iMessage] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = message.text
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastGuid = ''

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        chatGuid: channelId,
        message: chunk,
        method: 'private-api', // Use Private API for better delivery
      }

      // Send text message
      const res = await fetch(
        `${this.serverUrl}/api/v1/message/text?password=${encodeURIComponent(this.password)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`iMessage send failed: ${res.status} ${errText}`)
      }

      const result = (await res.json()) as { status: number; data?: { guid?: string } }
      lastGuid = result.data?.guid ?? `msg_${Date.now()}`
    }

    // Send attachments if present
    if (message.attachments && message.attachments.length > 0) {
      for (const att of message.attachments) {
        if (att.data) {
          await this.sendAttachment(channelId, att)
        }
      }
    }

    return lastGuid
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    // BlueBubbles supports tapback reactions
    // Map emoji to tapback type: love, like, dislike, laugh, emphasis, question
    const tapbackMap: Record<string, string> = {
      '❤️': 'love', '♥️': 'love',
      '👍': 'like',
      '👎': 'dislike',
      '😂': 'laugh', '😆': 'laugh',
      '‼️': 'emphasis', '❗': 'emphasis', '❕': 'emphasis',
      '❓': 'question', '❔': 'question',
    }

    const tapback = tapbackMap[emoji] ?? 'like'

    const res = await fetch(
      `${this.serverUrl}/api/v1/message/${encodeURIComponent(messageId)}/react?password=${encodeURIComponent(this.password)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatGuid: channelId,
          reaction: tapback,
        }),
      },
    )

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`iMessage react failed: ${res.status} ${errText}`)
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'iMessage',
      description: 'iMessage adapter via BlueBubbles REST API (requires Mac host)',
      requiredCredentials: ['server_url', 'password'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Polling ──────────────────────────────────────────────────

  private startPolling(): void {
    this.pollingAbort = new AbortController()
    this.poll()
  }

  private stopPolling(): void {
    this.pollingAbort?.abort()
    this.pollingAbort = null
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async poll(): Promise<void> {
    while (this.pollingAbort && !this.pollingAbort.signal.aborted) {
      try {
        // Query for messages since last poll
        const params = new URLSearchParams({
          password: this.password,
          after: String(this.lastMessageDate),
          limit: '50',
          sort: 'ASC',
          with: 'chat,attachment',
        })

        const res = await fetch(
          `${this.serverUrl}/api/v1/message?${params.toString()}`,
          { signal: this.pollingAbort.signal },
        )

        if (!res.ok) {
          console.error(`[iMessage] Poll error: ${res.status} ${res.statusText}`)
          await sleep(5000)
          continue
        }

        const result = (await res.json()) as { status: number; data?: BlueBubblesMessage[] }
        const messages = result.data ?? []

        for (const msg of messages) {
          // Skip already-processed messages
          if (msg.guid && this.processedGuids.has(msg.guid)) continue
          if (msg.guid) this.processedGuids.add(msg.guid)

          // Update last poll timestamp
          if (msg.dateCreated && msg.dateCreated > this.lastMessageDate) {
            this.lastMessageDate = msg.dateCreated
          }

          // Skip sent messages (from us)
          if (msg.isFromMe) continue

          await this.handleMessage(msg)
        }

        // Poll interval — 2 seconds
        await sleep(2000)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error(`[iMessage] Polling error: ${(err as Error).message}`)
        await sleep(5000)
      }
    }
  }

  private async handleMessage(msg: BlueBubblesMessage): Promise<void> {
    if (!msg.text && !msg.subject) return

    // Determine sender
    const handle = msg.handle?.address ?? msg.handleId ?? ''

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(handle)) return

    // Determine chat GUID (used as channelId)
    const chatGuid = msg.chats?.[0]?.guid ?? `iMessage;-;${handle}`

    // Build attachments
    const attachments: Attachment[] = (msg.attachments ?? []).map((att: BlueBubblesAttachment) => ({
      type: att.mimeType?.startsWith('image/') ? 'image' as const : 'file' as const,
      filename: att.transferName ?? att.guid,
      mimeType: att.mimeType,
      url: att.guid ? `${this.serverUrl}/api/v1/attachment/${encodeURIComponent(att.guid)}/download?password=${encodeURIComponent(this.password)}` : undefined,
    }))

    const text = msg.text ?? msg.subject ?? ''

    const incoming: IncomingMessage = {
      platform: 'imessage',
      platformUserId: handle,
      platformUserName: msg.handle?.address ?? handle,
      channelId: chatGuid,
      messageId: msg.guid ?? String(Date.now()),
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: new Date(msg.dateCreated ?? Date.now()),
      raw: msg,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[iMessage] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Attachment Sending ───────────────────────────────────────

  private async sendAttachment(chatGuid: string, attachment: Attachment): Promise<void> {
    // BlueBubbles expects multipart/form-data for attachment uploads
    // For simplicity, use the base64 API if available
    if (!attachment.data) return

    const body = {
      chatGuid,
      name: attachment.filename ?? 'file',
      attachment: attachment.data.toString('base64'),
    }

    const res = await fetch(
      `${this.serverUrl}/api/v1/message/attachment?password=${encodeURIComponent(this.password)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[iMessage] Attachment send failed: ${res.status} ${errText}`)
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── BlueBubbles-specific types ───────────────────────────────────

interface BlueBubblesMessage {
  guid?: string
  text?: string
  subject?: string
  isFromMe?: boolean
  handleId?: string
  dateCreated?: number
  dateDelivered?: number
  handle?: {
    address?: string
    service?: string
  }
  chats?: Array<{
    guid?: string
    chatIdentifier?: string
    displayName?: string
  }>
  attachments?: BlueBubblesAttachment[]
}

interface BlueBubblesAttachment {
  guid?: string
  transferName?: string
  mimeType?: string
  totalBytes?: number
}
