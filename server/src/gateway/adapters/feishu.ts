/**
 * Feishu (Lark) Adapter
 *
 * Receives messages via event subscription webhook at /gateway/feishu/events.
 * Sends messages via the Feishu Open API im/v1/messages.
 * Tenant access token auto-refreshes.
 * Exports a webhookRouter for Express mounting at /gateway/feishu.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'
import { Router, type Request, type Response } from 'express'
import crypto from 'node:crypto'

const FEISHU_API = 'https://open.feishu.cn/open-apis'
const MAX_MESSAGE_LENGTH = 30000

export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const
  status: AdapterStatus = 'disconnected'

  private appId = ''
  private appSecret = ''
  private verificationToken = ''
  private encryptKey = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Tenant access token
  private tenantAccessToken = ''
  private tokenExpiresAt = 0
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

  // Deduplicate events by event ID
  private processedEvents = new Set<string>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  /** Express router — mount at /gateway/feishu on your app */
  readonly webhookRouter: Router = Router()

  constructor() {
    this.setupRoutes()
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.appId = config.credentials.app_id ?? ''
    this.appSecret = config.credentials.app_secret ?? ''
    this.verificationToken = config.credentials.verification_token ?? ''
    this.encryptKey = config.credentials.encrypt_key ?? ''

    if (!this.appId) throw new Error('Feishu adapter requires app_id credential')
    if (!this.appSecret) throw new Error('Feishu adapter requires app_secret credential')

    this.status = 'connecting'

    try {
      await this.refreshTenantAccessToken()
      console.log(`[Feishu] Connected with app ID: ${this.appId}`)
      this.status = 'connected'
      this.scheduleTokenRefresh()

      // Periodic event deduplication cache cleanup
      this.cleanupInterval = setInterval(() => {
        this.processedEvents.clear()
      }, 10 * 60 * 1000)
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Feishu] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.processedEvents.clear()
    this.tenantAccessToken = ''
    this.status = 'disconnected'
    console.log('[Feishu] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    await this.ensureToken()

    const text = message.text.slice(0, MAX_MESSAGE_LENGTH)
    const useMarkdown = message.format === 'markdown'

    // Determine receive_id_type: open_id, user_id, chat_id, or email
    let receiveIdType = 'open_id'
    if (channelId.startsWith('oc_')) receiveIdType = 'chat_id'
    else if (channelId.includes('@')) receiveIdType = 'email'
    else if (channelId.startsWith('ou_')) receiveIdType = 'open_id'
    else if (channelId.startsWith('on_')) receiveIdType = 'union_id'

    const body: Record<string, unknown> = {
      receive_id: channelId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }

    // Use interactive card for markdown content
    if (useMarkdown) {
      body.msg_type = 'interactive'
      body.content = JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{
          tag: 'markdown',
          content: text,
        }],
      })
    }

    // Reply to a specific message
    if (message.replyTo) {
      body.reply_in_thread = false
    }

    const url = `${FEISHU_API}/im/v1/messages?receive_id_type=${receiveIdType}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.tenantAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Feishu send failed: ${res.status} ${errText}`)
    }

    const result = (await res.json()) as { code: number; msg: string; data?: { message_id: string } }
    if (result.code !== 0) {
      throw new Error(`Feishu send error: ${result.code} ${result.msg}`)
    }

    return result.data?.message_id ?? `msg_${Date.now()}`
  }

  async edit(messageId: string, _channelId: string, message: OutgoingMessage): Promise<void> {
    await this.ensureToken()
    const text = message.text.slice(0, MAX_MESSAGE_LENGTH)

    const res = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.tenantAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Feishu edit failed: ${res.status} ${errText}`)
    }
  }

  async react(messageId: string, _channelId: string, emoji: string): Promise<void> {
    await this.ensureToken()

    const res = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.tenantAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reaction_type: { emoji_type: emoji },
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Feishu react failed: ${res.status} ${errText}`)
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Feishu',
      description: 'Feishu (Lark) adapter with event subscription webhook and tenant access token',
      requiredCredentials: ['app_id', 'app_secret', 'verification_token'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Webhook Routes ───────────────────────────────────────────

  private setupRoutes(): void {
    // Event subscription endpoint
    this.webhookRouter.post('/events', async (req: Request, res: Response) => {
      try {
        let body = req.body as Record<string, unknown>

        // Handle encrypted events
        if (body.encrypt && typeof body.encrypt === 'string' && this.encryptKey) {
          const decrypted = this.decryptEvent(body.encrypt as string)
          if (decrypted) {
            body = JSON.parse(decrypted) as Record<string, unknown>
          } else {
            res.sendStatus(403)
            return
          }
        }

        // URL verification challenge
        if (body.type === 'url_verification') {
          const challenge = body.challenge as string
          // Verify token
          if (body.token !== this.verificationToken) {
            res.sendStatus(403)
            return
          }
          res.status(200).json({ challenge })
          return
        }

        // Verify token for event callbacks
        if (body.token && body.token !== this.verificationToken) {
          res.sendStatus(403)
          return
        }

        // Respond 200 immediately to acknowledge receipt
        res.status(200).json({ code: 0 })

        // Process event
        await this.handleEvent(body)
      } catch (err) {
        console.error(`[Feishu] Webhook error: ${(err as Error).message}`)
        if (!res.headersSent) res.status(200).json({ code: 0 })
      }
    })
  }

  private async handleEvent(body: Record<string, unknown>): Promise<void> {
    if (this.status !== 'connected') return

    // v2.0 event schema
    const header = body.header as { event_id?: string; event_type?: string; token?: string } | undefined
    const event = body.event as Record<string, unknown> | undefined

    if (!header || !event) {
      // v1.0 event schema fallback
      await this.handleV1Event(body)
      return
    }

    // Deduplicate
    if (header.event_id) {
      if (this.processedEvents.has(header.event_id)) return
      this.processedEvents.add(header.event_id)
    }

    switch (header.event_type) {
      case 'im.message.receive_v1':
        await this.handleMessageEvent(event)
        break
      default:
        console.log(`[Feishu] Unhandled event type: ${header.event_type}`)
    }
  }

  private async handleV1Event(body: Record<string, unknown>): Promise<void> {
    const eventType = body.type as string
    const event = body.event as Record<string, unknown> | undefined
    if (!event) return

    // Deduplicate
    const eventId = body.uuid as string
    if (eventId) {
      if (this.processedEvents.has(eventId)) return
      this.processedEvents.add(eventId)
    }

    if (eventType === 'event_callback') {
      const msgType = event.msg_type as string
      if (msgType === 'text') {
        const userId = (event.open_id as string) ?? ''
        const userName = (event.user_id as string) ?? userId

        const allowed = this.config?.settings.allowedUsers
        if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

        const incoming: IncomingMessage = {
          platform: 'feishu',
          platformUserId: userId,
          platformUserName: userName,
          channelId: (event.open_chat_id as string) ?? userId,
          messageId: (event.open_message_id as string) ?? String(Date.now()),
          text: (event.text_without_at_bot as string) ?? (event.text as string) ?? '',
          timestamp: new Date(),
          raw: body,
        }

        await this.messageHandler?.(incoming)
      }
    }
  }

  private async handleMessageEvent(event: Record<string, unknown>): Promise<void> {
    const sender = event.sender as { sender_id?: { open_id?: string; user_id?: string; union_id?: string }; sender_type?: string } | undefined
    const message = event.message as {
      message_id?: string
      chat_id?: string
      chat_type?: string
      content?: string
      message_type?: string
      root_id?: string
      parent_id?: string
      create_time?: string
    } | undefined

    if (!message || !sender) return
    if (message.message_type !== 'text') return

    const userId = sender.sender_id?.open_id ?? sender.sender_id?.user_id ?? ''

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

    // Parse content JSON
    let text = ''
    try {
      const content = JSON.parse(message.content ?? '{}') as { text?: string }
      text = content.text ?? ''
    } catch {
      text = message.content ?? ''
    }

    // Strip @mention of the bot
    text = text.replace(/@_user_\d+/g, '').trim()

    if (!text) return

    const incoming: IncomingMessage = {
      platform: 'feishu',
      platformUserId: userId,
      platformUserName: userId,
      channelId: message.chat_id ?? userId,
      messageId: message.message_id ?? String(Date.now()),
      text,
      replyTo: message.parent_id ?? message.root_id,
      timestamp: new Date(parseInt(message.create_time ?? String(Date.now()), 10)),
      raw: event,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[Feishu] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Event Decryption ─────────────────────────────────────────

  private decryptEvent(encrypted: string): string | null {
    if (!this.encryptKey) return null

    try {
      const keyHash = crypto.createHash('sha256').update(this.encryptKey).digest()
      const encBuf = Buffer.from(encrypted, 'base64')

      // IV is first 16 bytes
      const iv = encBuf.subarray(0, 16)
      const ciphertext = encBuf.subarray(16)

      const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv)
      let decrypted = decipher.update(ciphertext, undefined, 'utf-8')
      decrypted += decipher.final('utf-8')

      return decrypted
    } catch (err) {
      console.error(`[Feishu] Decryption error: ${(err as Error).message}`)
      return null
    }
  }

  // ── Tenant Access Token ──────────────────────────────────────

  private async refreshTenantAccessToken(): Promise<void> {
    const res = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    })

    if (!res.ok) {
      throw new Error(`Token fetch failed: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { code: number; msg: string; tenant_access_token?: string; expire?: number }

    if (data.code !== 0) {
      throw new Error(`Feishu token error: ${data.code} ${data.msg}`)
    }

    if (!data.tenant_access_token) {
      throw new Error('No tenant_access_token in response')
    }

    this.tenantAccessToken = data.tenant_access_token
    this.tokenExpiresAt = Date.now() + (data.expire ?? 7200) * 1000
    console.log(`[Feishu] Tenant access token refreshed, expires in ${data.expire ?? 7200}s`)
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)

    const refreshIn = Math.max((this.tokenExpiresAt - Date.now()) - 300_000, 60_000)
    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshTenantAccessToken()
        this.scheduleTokenRefresh()
      } catch (err) {
        console.error(`[Feishu] Token refresh error: ${(err as Error).message}`)
        this.tokenRefreshTimer = setTimeout(() => this.scheduleTokenRefresh(), 30_000)
      }
    }, refreshIn)
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt - 60_000) {
      await this.refreshTenantAccessToken()
    }
  }
}
