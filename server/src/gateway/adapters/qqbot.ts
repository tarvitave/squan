/**
 * QQ Bot Official API v2 Adapter
 *
 * Connects via WebSocket gateway for receiving events.
 * Sends messages via the REST API /channels/{id}/messages.
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

const QQ_API = 'https://api.sgroup.qq.com'
const QQ_SANDBOX_API = 'https://sandbox.api.sgroup.qq.com'
const MAX_MESSAGE_LENGTH = 4096

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

export class QQBotAdapter implements PlatformAdapter {
  readonly platform = 'qqbot' as const
  status: AdapterStatus = 'disconnected'

  private appId = ''
  private appSecret = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // OAuth access token
  private accessToken = ''
  private tokenExpiresAt = 0
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

  // WebSocket state
  private ws: WebSocket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatAcked = true
  private lastSequence: number | null = null
  private sessionId = ''
  private reconnecting = false
  private botUserId = ''

  // Use sandbox API in dev
  private apiBase = QQ_API

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.appId = config.credentials.app_id ?? ''
    this.appSecret = config.credentials.app_secret ?? ''

    if (!this.appId) throw new Error('QQ Bot adapter requires app_id credential')
    if (!this.appSecret) throw new Error('QQ Bot adapter requires app_secret credential')

    // Use sandbox API if configured
    if (config.credentials.sandbox === 'true') {
      this.apiBase = QQ_SANDBOX_API
    }

    this.status = 'connecting'

    try {
      await this.refreshAccessToken()
      this.scheduleTokenRefresh()

      // Get WebSocket gateway URL
      const gateway = await this.apiCall<{ url: string }>('GET', '/gateway')
      console.log(`[QQBot] Gateway URL: ${gateway.url}`)

      await this.connectGateway(gateway.url)
    } catch (err) {
      this.status = 'error'
      throw new Error(`[QQBot] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close(1000, 'Disconnect requested')
      this.ws = null
    }
    this.accessToken = ''
    this.status = 'disconnected'
    console.log('[QQBot] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    await this.ensureToken()
    const text = message.text
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastMessageId = ''

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        content: chunk,
      }

      if (message.replyTo && lastMessageId === '') {
        body.msg_id = message.replyTo
      }

      // Determine endpoint: /channels/{id}/messages for guild channels,
      // /dms/{id}/messages for DMs, /groups/{id}/messages for group chats
      let endpoint: string
      if (channelId.startsWith('dm_')) {
        endpoint = `/dms/${channelId.slice(3)}/messages`
      } else if (channelId.startsWith('group_')) {
        endpoint = `/v2/groups/${channelId.slice(6)}/messages`
        body.msg_type = 0 // text
        body.content = chunk
      } else {
        endpoint = `/channels/${channelId}/messages`
      }

      const result = await this.apiCall<{ id: string }>(
        'POST',
        endpoint,
        body,
      )
      lastMessageId = result.id ?? `msg_${Date.now()}`
    }

    return lastMessageId
  }

  async edit(messageId: string, channelId: string, message: OutgoingMessage): Promise<void> {
    await this.ensureToken()
    const text = message.text.slice(0, MAX_MESSAGE_LENGTH)

    await this.apiCall('PATCH', `/channels/${channelId}/messages/${messageId}`, {
      content: text,
    })
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    await this.ensureToken()

    // QQ Bot uses emoji type 1 for system emojis, type 2 for custom
    await this.apiCall(
      'PUT',
      `/channels/${channelId}/messages/${messageId}/reactions/1/${encodeURIComponent(emoji)}`,
    )
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'QQ Bot',
      description: 'QQ Bot Official API v2 adapter with WebSocket gateway',
      requiredCredentials: ['app_id', 'app_secret'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode', 'sandbox'],
    }
  }

  // ── Gateway WebSocket ────────────────────────────────────────

  private connectGateway(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)
      let resolved = false

      this.ws.on('open', () => {
        console.log('[QQBot] Gateway WebSocket opened')
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        const payload = JSON.parse(data.toString()) as GatewayPayload
        this.handleGatewayMessage(payload)

        if (payload.op === OP.DISPATCH && payload.t === 'READY' && !resolved) {
          resolved = true
          resolve()
        }
      })

      this.ws.on('close', (code, reason) => {
        console.log(`[QQBot] Gateway closed: ${code} ${reason.toString()}`)
        this.stopHeartbeat()

        if (!resolved) {
          resolved = true
          reject(new Error(`Gateway closed during connect: ${code}`))
          return
        }

        if (this.status !== 'disconnected' && !this.reconnecting) {
          this.scheduleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        console.error(`[QQBot] Gateway error: ${err.message}`)
        if (!resolved) {
          resolved = true
          reject(err)
        }
      })
    })
  }

  private handleGatewayMessage(payload: GatewayPayload): void {
    if (payload.s !== null && payload.s !== undefined) {
      this.lastSequence = payload.s
    }

    switch (payload.op) {
      case OP.HELLO: {
        const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval
        this.startHeartbeat(interval)

        if (this.sessionId) {
          // Resume
          this.sendGateway(OP.RESUME, {
            token: `QQBot ${this.accessToken}`,
            session_id: this.sessionId,
            seq: this.lastSequence,
          })
        } else {
          // Identify
          this.sendGateway(OP.IDENTIFY, {
            token: `QQBot ${this.accessToken}`,
            intents: this.getIntents(),
            shard: [0, 1],
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
        console.log('[QQBot] Server requested reconnect')
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
        const d = payload.d as { session_id: string; user: { id: string; username: string } }
        this.sessionId = d.session_id
        this.botUserId = d.user?.id ?? ''
        this.status = 'connected'
        this.reconnecting = false
        console.log(`[QQBot] READY — session ${this.sessionId}, user ${d.user?.username ?? 'unknown'}`)
        break
      }

      case 'RESUMED':
        this.status = 'connected'
        this.reconnecting = false
        console.log('[QQBot] Session resumed')
        break

      case 'AT_MESSAGE_CREATE':
      case 'MESSAGE_CREATE':
      case 'DIRECT_MESSAGE_CREATE':
      case 'GROUP_AT_MESSAGE_CREATE':
      case 'C2C_MESSAGE_CREATE':
        this.handleMessageEvent(payload.t!, payload.d as QQMessage).catch((err) =>
          console.error(`[QQBot] Message handler error: ${(err as Error).message}`),
        )
        break
    }
  }

  private async handleMessageEvent(eventType: string, msg: QQMessage): Promise<void> {
    // Ignore own messages
    if (msg.author?.id === this.botUserId) return
    if (msg.author?.bot) return

    const userId = msg.author?.id ?? ''

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

    // Clean up message content (remove @mentions)
    let text = msg.content ?? ''
    text = text.replace(/<@!?\d+>/g, '').trim()
    if (!text) return

    // Determine channel ID based on event type
    let channelId = msg.channel_id ?? ''
    if (eventType === 'DIRECT_MESSAGE_CREATE') {
      channelId = `dm_${msg.guild_id ?? msg.channel_id ?? ''}`
    } else if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
      channelId = `group_${msg.group_openid ?? msg.channel_id ?? ''}`
    } else if (eventType === 'C2C_MESSAGE_CREATE') {
      channelId = `dm_${msg.author?.id ?? ''}`
    }

    const incoming: IncomingMessage = {
      platform: 'qqbot',
      platformUserId: userId,
      platformUserName: msg.author?.username ?? userId,
      channelId,
      messageId: msg.id ?? String(Date.now()),
      text,
      timestamp: new Date(msg.timestamp ?? Date.now()),
      raw: msg,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[QQBot] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Intents ──────────────────────────────────────────────────

  private getIntents(): number {
    // Bitwise OR of intent flags
    // GUILDS (0), GUILD_MEMBERS (1), GUILD_MESSAGES (9), GUILD_MESSAGE_REACTIONS (10),
    // DIRECT_MESSAGE (12), GROUP_AND_C2C_EVENT (25), INTERACTION (26),
    // MESSAGE_AUDIT (27), AUDIO_ACTION (29), PUBLIC_GUILD_MESSAGES (30)
    return (1 << 0) | (1 << 9) | (1 << 10) | (1 << 12) | (1 << 25) | (1 << 30)
  }

  // ── Heartbeat ────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat()
    this.heartbeatAcked = true

    setTimeout(() => {
      this.sendGateway(OP.HEARTBEAT, this.lastSequence)
    }, intervalMs * Math.random())

    this.heartbeatInterval = setInterval(() => {
      if (!this.heartbeatAcked) {
        console.warn('[QQBot] Heartbeat not ACKed — reconnecting')
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

  private async scheduleReconnect(): Promise<void> {
    this.reconnecting = true
    this.status = 'connecting'
    const delay = 5000 + Math.random() * 5000
    console.log(`[QQBot] Reconnecting in ${Math.round(delay)}ms...`)
    setTimeout(async () => {
      if (!this.reconnecting) return
      try {
        await this.ensureToken()
        const gateway = await this.apiCall<{ url: string }>('GET', '/gateway')
        await this.connectGateway(gateway.url)
      } catch (err) {
        console.error(`[QQBot] Reconnect failed: ${(err as Error).message}`)
        this.scheduleReconnect()
      }
    }, delay)
  }

  // ── Helpers ──────────────────────────────────────────────────

  private sendGateway(op: number, d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }))
    }
  }

  private async apiCall<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    await this.ensureToken()

    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`QQBot API ${method} ${path}: ${res.status} ${text}`)
    }

    if (res.status === 204) return undefined as unknown as T
    return (await res.json()) as T
  }

  // ── Access Token ─────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const res = await fetch(`https://bots.qq.com/app/getAppAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: this.appId,
        clientSecret: this.appSecret,
      }),
    })

    if (!res.ok) {
      throw new Error(`Token fetch failed: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number }

    if (!data.access_token) {
      throw new Error('No access_token in response')
    }

    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (parseInt(String(data.expires_in ?? 7200), 10)) * 1000
    console.log(`[QQBot] Access token refreshed, expires in ${data.expires_in ?? 7200}s`)
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)

    const refreshIn = Math.max((this.tokenExpiresAt - Date.now()) - 300_000, 60_000)
    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshAccessToken()
        this.scheduleTokenRefresh()
      } catch (err) {
        console.error(`[QQBot] Token refresh error: ${(err as Error).message}`)
        this.tokenRefreshTimer = setTimeout(() => this.scheduleTokenRefresh(), 30_000)
      }
    }, refreshIn)
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt - 60_000) {
      await this.refreshAccessToken()
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

// ── QQ Bot-specific types ────────────────────────────────────────

interface GatewayPayload {
  op: number
  d: unknown
  s?: number | null
  t?: string | null
}

interface QQMessage {
  id?: string
  channel_id?: string
  guild_id?: string
  group_openid?: string
  content?: string
  timestamp?: string
  author?: {
    id: string
    username?: string
    bot?: boolean
  }
  member?: {
    nick?: string
    roles?: string[]
  }
}
