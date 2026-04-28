/**
 * Discord Bot Adapter
 *
 * Connects via the Discord Gateway WebSocket for receiving events.
 * Sends messages via the Discord REST API.
 * Requires the 'ws' package for WebSocket connectivity.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'
import WebSocket from 'ws'

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json'
const MAX_MESSAGE_LENGTH = 2000

// Gateway opcodes
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord' as const
  status: AdapterStatus = 'disconnected'

  private botToken = ''
  private applicationId = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // WebSocket state
  private ws: WebSocket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatAcked = true
  private lastSequence: number | null = null
  private sessionId = ''
  private resumeGatewayUrl = ''
  private botUserId = ''
  private reconnecting = false

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.botToken = config.credentials.bot_token
    this.applicationId = config.credentials.application_id ?? ''
    if (!this.botToken) throw new Error('Discord adapter requires bot_token credential')

    this.status = 'connecting'

    try {
      // Validate token by fetching the bot user
      const me = await this.apiCall<{ id: string; username: string }>('GET', '/users/@me')
      this.botUserId = me.id
      console.log(`[Discord] Authenticated as ${me.username} (${me.id})`)

      await this.connectGateway()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Discord] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close(1000, 'Disconnect requested')
      this.ws = null
    }
    this.status = 'disconnected'
    console.log('[Discord] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = this.formatOutgoing(message)
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastMessageId = ''

    for (const chunk of chunks) {
      const body: Record<string, unknown> = { content: chunk }
      if (message.replyTo && lastMessageId === '') {
        body.message_reference = { message_id: message.replyTo }
      }

      const result = await this.apiCall<{ id: string }>(
        'POST',
        `/channels/${channelId}/messages`,
        body,
      )
      lastMessageId = result.id
    }

    return lastMessageId
  }

  async edit(messageId: string, channelId: string, message: OutgoingMessage): Promise<void> {
    const text = this.formatOutgoing(message)
    await this.apiCall('PATCH', `/channels/${channelId}/messages/${messageId}`, {
      content: text.slice(0, MAX_MESSAGE_LENGTH),
    })
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    const encoded = encodeURIComponent(emoji)
    await this.apiCall(
      'PUT',
      `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
    )
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Discord',
      description: 'Discord bot adapter using Gateway WebSocket and REST API',
      requiredCredentials: ['bot_token', 'application_id'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Gateway WebSocket ────────────────────────────────────────

  private connectGateway(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.resumeGatewayUrl || DISCORD_GATEWAY
      this.ws = new WebSocket(url)
      let resolved = false

      this.ws.on('open', () => {
        console.log('[Discord] Gateway WebSocket opened')
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        const payload = JSON.parse(data.toString()) as GatewayPayload
        this.handleGatewayMessage(payload)

        // Resolve the connect promise once we're identified
        if (payload.op === OP.DISPATCH && payload.t === 'READY' && !resolved) {
          resolved = true
          resolve()
        }
      })

      this.ws.on('close', (code, reason) => {
        console.log(`[Discord] Gateway closed: ${code} ${reason.toString()}`)
        this.stopHeartbeat()

        if (!resolved) {
          resolved = true
          reject(new Error(`Gateway closed during connect: ${code}`))
          return
        }

        // Auto-reconnect for recoverable close codes
        if (this.status !== 'disconnected' && !this.reconnecting) {
          this.scheduleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        console.error(`[Discord] Gateway error: ${err.message}`)
        if (!resolved) {
          resolved = true
          reject(err)
        }
      })
    })
  }

  private handleGatewayMessage(payload: GatewayPayload): void {
    // Track sequence number
    if (payload.s !== null && payload.s !== undefined) {
      this.lastSequence = payload.s
    }

    switch (payload.op) {
      case OP.HELLO: {
        const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval
        this.startHeartbeat(interval)
        // Send IDENTIFY or RESUME
        if (this.sessionId) {
          this.sendGateway(OP.RESUME, {
            token: this.botToken,
            session_id: this.sessionId,
            seq: this.lastSequence,
          })
        } else {
          this.sendGateway(OP.IDENTIFY, {
            token: this.botToken,
            intents: (1 << 9) | (1 << 15) | (1 << 12), // GUILDS, MESSAGE_CONTENT, GUILD_MESSAGES
            properties: { os: 'linux', browser: 'squan', device: 'squan' },
          })
        }
        break
      }

      case OP.HEARTBEAT:
        this.sendGateway(OP.HEARTBEAT, this.lastSequence)
        break

      case OP.HEARTBEAT_ACK:
        this.heartbeatAcked = true
        break

      case OP.RECONNECT:
        console.log('[Discord] Server requested reconnect')
        this.ws?.close(4000, 'Reconnect requested')
        break

      case OP.INVALID_SESSION: {
        const resumable = payload.d as boolean
        if (!resumable) {
          this.sessionId = ''
          this.lastSequence = null
        }
        setTimeout(() => {
          this.ws?.close(4000, 'Invalid session')
        }, Math.random() * 5000 + 1000)
        break
      }

      case OP.DISPATCH:
        this.handleDispatch(payload)
        break
    }
  }

  private handleDispatch(payload: GatewayPayload): void {
    switch (payload.t) {
      case 'READY': {
        const d = payload.d as { session_id: string; resume_gateway_url: string; user: { id: string } }
        this.sessionId = d.session_id
        this.resumeGatewayUrl = d.resume_gateway_url
        this.botUserId = d.user.id
        this.status = 'connected'
        this.reconnecting = false
        console.log(`[Discord] READY — session ${this.sessionId}`)
        break
      }

      case 'RESUMED':
        this.status = 'connected'
        this.reconnecting = false
        console.log('[Discord] Session resumed')
        break

      case 'MESSAGE_CREATE':
        this.handleMessageCreate(payload.d as DiscordMessage).catch((err) =>
          console.error(`[Discord] Message handler error: ${(err as Error).message}`),
        )
        break
    }
  }

  private async handleMessageCreate(msg: DiscordMessage): Promise<void> {
    // Ignore our own messages
    if (msg.author.id === this.botUserId) return
    // Ignore other bots
    if (msg.author.bot) return

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(msg.author.id)) return

    // Strip bot mention from text if present
    let text = msg.content
    const mentionPattern = new RegExp(`<@!?${this.botUserId}>\\s*`, 'g')
    text = text.replace(mentionPattern, '').trim()

    // Determine channel (support threads via the thread parent)
    const channelId = msg.thread?.id ?? msg.channel_id

    const incoming: IncomingMessage = {
      platform: 'discord',
      platformUserId: msg.author.id,
      platformUserName: msg.author.username,
      channelId,
      messageId: msg.id,
      text,
      replyTo: msg.message_reference?.message_id,
      timestamp: new Date(msg.timestamp),
      raw: msg,
    }

    await this.messageHandler?.(incoming)
  }

  // ── Heartbeat ────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat()
    this.heartbeatAcked = true

    // Send first heartbeat after jitter
    setTimeout(() => {
      this.sendGateway(OP.HEARTBEAT, this.lastSequence)
    }, intervalMs * Math.random())

    this.heartbeatInterval = setInterval(() => {
      if (!this.heartbeatAcked) {
        console.warn('[Discord] Heartbeat not ACKed — reconnecting')
        this.ws?.close(4009, 'Heartbeat timeout')
        return
      }
      this.heartbeatAcked = false
      this.sendGateway(OP.HEARTBEAT, this.lastSequence)
    }, intervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // ── Reconnection ─────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.reconnecting = true
    this.status = 'connecting'
    const delay = 5000 + Math.random() * 5000
    console.log(`[Discord] Reconnecting in ${Math.round(delay)}ms...`)
    setTimeout(() => {
      if (this.reconnecting) {
        this.connectGateway().catch((err) => {
          console.error(`[Discord] Reconnect failed: ${(err as Error).message}`)
          this.scheduleReconnect()
        })
      }
    }, delay)
  }

  // ── Helpers ──────────────────────────────────────────────────

  private sendGateway(op: number, d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }))
    }
  }

  private formatOutgoing(message: OutgoingMessage): string {
    // Discord natively supports markdown, so pass through
    return message.text
  }

  private async apiCall<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Discord API ${method} ${path}: ${res.status} ${text}`)
    }

    // Some endpoints return 204 No Content
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
    if (splitIdx < maxLen * 0.3) {
      splitIdx = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitIdx < maxLen * 0.3) {
      splitIdx = maxLen
    }
    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }
  return chunks
}

// ── Discord-specific types ───────────────────────────────────────

interface GatewayPayload {
  op: number
  d: unknown
  s?: number | null
  t?: string | null
}

interface DiscordMessage {
  id: string
  channel_id: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  timestamp: string
  message_reference?: { message_id: string }
  thread?: { id: string }
}
