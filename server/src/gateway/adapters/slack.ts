/**
 * Slack Adapter
 *
 * Connects via Socket Mode (WebSocket) to receive events.
 * Sends messages via the Slack Web API (chat.postMessage, etc.).
 * Requires the 'ws' package for Socket Mode connectivity.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'
import WebSocket from 'ws'

const SLACK_API = 'https://slack.com/api'
const MAX_MESSAGE_LENGTH = 40000 // Slack text block limit (practical: ~4000 for readability)

export class SlackAdapter implements PlatformAdapter {
  readonly platform = 'slack' as const
  status: AdapterStatus = 'disconnected'

  private botToken = ''
  private appToken = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // WebSocket state
  private ws: WebSocket | null = null
  private botUserId = ''
  private reconnecting = false
  private pingInterval: ReturnType<typeof setInterval> | null = null

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.botToken = config.credentials.bot_token
    this.appToken = config.credentials.app_token
    if (!this.botToken) throw new Error('Slack adapter requires bot_token credential')
    if (!this.appToken) throw new Error('Slack adapter requires app_token credential for Socket Mode')

    this.status = 'connecting'

    try {
      // Get bot user ID
      const authResult = await this.webApi<{ user_id: string }>('auth.test', {})
      this.botUserId = authResult.user_id
      console.log(`[Slack] Authenticated as bot user ${this.botUserId}`)

      // Open Socket Mode connection
      await this.connectSocketMode()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Slack] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false
    this.stopPing()
    if (this.ws) {
      this.ws.close(1000, 'Disconnect requested')
      this.ws = null
    }
    this.status = 'disconnected'
    console.log('[Slack] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = this.formatOutgoing(message)
    const body: Record<string, unknown> = {
      channel: channelId,
      text,
    }
    if (message.replyTo) {
      // Reply in thread
      body.thread_ts = message.replyTo
    }

    const result = await this.webApi<{ ts: string; channel: string }>('chat.postMessage', body)
    return result.ts
  }

  async edit(messageId: string, channelId: string, message: OutgoingMessage): Promise<void> {
    const text = this.formatOutgoing(message)
    await this.webApi('chat.update', {
      channel: channelId,
      ts: messageId,
      text,
    })
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    // Slack uses emoji names without colons, e.g. "thumbsup"
    const name = emoji.replace(/:/g, '')
    await this.webApi('reactions.add', {
      channel: channelId,
      timestamp: messageId,
      name,
    })
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Slack',
      description: 'Slack adapter using Socket Mode and Web API',
      requiredCredentials: ['bot_token', 'app_token'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Socket Mode ──────────────────────────────────────────────

  private async connectSocketMode(): Promise<void> {
    // Request a WebSocket URL via apps.connections.open
    const res = await fetch(`${SLACK_API}/apps.connections.open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    const data = (await res.json()) as { ok: boolean; url?: string; error?: string }
    if (!data.ok || !data.url) {
      throw new Error(`Socket Mode open failed: ${data.error ?? 'no url'}`)
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(data.url!)
      let resolved = false

      this.ws.on('open', () => {
        console.log('[Slack] Socket Mode connected')
        this.status = 'connected'
        this.reconnecting = false
        this.startPing()
        if (!resolved) {
          resolved = true
          resolve()
        }
      })

      this.ws.on('message', (raw: WebSocket.Data) => {
        const payload = JSON.parse(raw.toString()) as SocketModePayload
        this.handleSocketMessage(payload)
      })

      this.ws.on('close', (code, reason) => {
        console.log(`[Slack] Socket closed: ${code} ${reason.toString()}`)
        this.stopPing()
        if (!resolved) {
          resolved = true
          reject(new Error(`Socket closed during connect: ${code}`))
          return
        }
        if (this.status !== 'disconnected' && !this.reconnecting) {
          this.scheduleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        console.error(`[Slack] Socket error: ${err.message}`)
        if (!resolved) {
          resolved = true
          reject(err)
        }
      })
    })
  }

  private handleSocketMessage(payload: SocketModePayload): void {
    // Acknowledge all envelope messages
    if (payload.envelope_id) {
      this.ws?.send(JSON.stringify({ envelope_id: payload.envelope_id }))
    }

    // Handle disconnect
    if (payload.type === 'disconnect') {
      console.log(`[Slack] Disconnect requested: ${payload.reason ?? 'unknown'}`)
      this.ws?.close(1000)
      return
    }

    // Handle events_api type
    if (payload.type === 'events_api' && payload.payload?.event) {
      const event = payload.payload.event as SlackEvent
      if (event.type === 'message' && !event.subtype && event.text) {
        this.handleMessageEvent(event).catch((err) =>
          console.error(`[Slack] Message handler error: ${(err as Error).message}`),
        )
      }
    }

    // Handle slash commands
    if (payload.type === 'slash_commands' && payload.payload) {
      this.handleSlashCommand(payload.payload as SlackSlashCommand).catch((err) =>
        console.error(`[Slack] Slash command error: ${(err as Error).message}`),
      )
    }
  }

  private async handleMessageEvent(event: SlackEvent): Promise<void> {
    // Ignore bot messages (including our own)
    if (event.bot_id) return
    if (event.user === this.botUserId) return

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(event.user ?? '')) return

    // Strip bot mention
    let text = event.text ?? ''
    const mentionPattern = new RegExp(`<@${this.botUserId}>\\s*`, 'g')
    text = text.replace(mentionPattern, '').trim()

    if (!text) return

    const incoming: IncomingMessage = {
      platform: 'slack',
      platformUserId: event.user ?? '',
      platformUserName: event.user ?? 'unknown', // Could resolve via users.info
      channelId: event.channel ?? '',
      messageId: event.ts ?? '',
      text,
      replyTo: event.thread_ts !== event.ts ? event.thread_ts : undefined,
      timestamp: new Date(parseFloat(event.ts ?? '0') * 1000),
      raw: event,
    }

    await this.messageHandler?.(incoming)
  }

  private async handleSlashCommand(cmd: SlackSlashCommand): Promise<void> {
    const incoming: IncomingMessage = {
      platform: 'slack',
      platformUserId: cmd.user_id ?? '',
      platformUserName: cmd.user_name ?? 'unknown',
      channelId: cmd.channel_id ?? '',
      messageId: `cmd_${Date.now()}`,
      text: `${cmd.command ?? ''} ${cmd.text ?? ''}`.trim(),
      timestamp: new Date(),
      raw: cmd,
    }

    await this.messageHandler?.(incoming)
  }

  // ── Keep-alive ───────────────────────────────────────────────

  private startPing(): void {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, 30_000)
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
    console.log(`[Slack] Reconnecting in ${Math.round(delay)}ms...`)
    setTimeout(() => {
      if (this.reconnecting) {
        this.connectSocketMode().catch((err) => {
          console.error(`[Slack] Reconnect failed: ${(err as Error).message}`)
          this.scheduleReconnect()
        })
      }
    }, delay)
  }

  // ── Helpers ──────────────────────────────────────────────────

  private formatOutgoing(message: OutgoingMessage): string {
    if (message.format === 'markdown') {
      return markdownToMrkdwn(message.text)
    }
    return message.text
  }

  private async webApi<T = unknown>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    })

    const data = (await res.json()) as { ok: boolean; error?: string } & T
    if (!data.ok) {
      throw new Error(`Slack API ${method}: ${data.error ?? res.statusText}`)
    }
    return data as T
  }
}

// ── Markdown → Slack mrkdwn conversion ───────────────────────────

function markdownToMrkdwn(text: string): string {
  let result = text

  // Bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*')

  // Italic: _text_ stays _text_ (same in mrkdwn)
  // But *text* (single asterisk italic in MD) conflicts with bold in mrkdwn
  // We handle **text** first, then remaining single * italic → _text_
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_')

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~')

  // Inline code: `text` stays `text` (same)

  // Code blocks: ```lang\n...\n``` stays the same (Slack supports it)

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')

  // Headers: # text → *text* (bold, since Slack has no headers in mrkdwn)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

  // Unordered lists: - or * → • (Slack convention)
  result = result.replace(/^[\s]*[-*]\s+/gm, '• ')

  return result
}

// ── Slack-specific types ─────────────────────────────────────────

interface SocketModePayload {
  type: string
  envelope_id?: string
  payload?: {
    event?: unknown
    [key: string]: unknown
  }
  reason?: string
}

interface SlackEvent {
  type: string
  subtype?: string
  user?: string
  bot_id?: string
  text?: string
  ts?: string
  thread_ts?: string
  channel?: string
}

interface SlackSlashCommand {
  command?: string
  text?: string
  user_id?: string
  user_name?: string
  channel_id?: string
}
