/**
 * DingTalk Robot Adapter
 *
 * Sends messages via the DingTalk Robot webhook URL with Markdown formatting.
 * Receives messages via the DingTalk Stream API (long-lived HTTP connection)
 * for enterprise internal bots, or via callback URL webhook for custom robots.
 * Exports a webhookRouter for Express mounting at /gateway/dingtalk.
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

const DINGTALK_API = 'https://api.dingtalk.com'
const DINGTALK_OAPI = 'https://oapi.dingtalk.com'
const MAX_MESSAGE_LENGTH = 20000

export class DingTalkAdapter implements PlatformAdapter {
  readonly platform = 'dingtalk' as const
  status: AdapterStatus = 'disconnected'

  private appKey = ''
  private appSecret = ''
  private robotCode = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Access token for API calls
  private accessToken = ''
  private tokenExpiresAt = 0
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

  // Stream connection
  private streamAbort: AbortController | null = null
  private streamReconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Express router — mount at /gateway/dingtalk for callback URL mode */
  readonly webhookRouter: Router = Router()

  constructor() {
    this.setupRoutes()
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.appKey = config.credentials.app_key ?? ''
    this.appSecret = config.credentials.app_secret ?? ''
    this.robotCode = config.credentials.robot_code ?? ''

    if (!this.appKey) throw new Error('DingTalk adapter requires app_key credential')
    if (!this.appSecret) throw new Error('DingTalk adapter requires app_secret credential')

    this.status = 'connecting'

    try {
      await this.refreshAccessToken()
      console.log(`[DingTalk] Connected with app key: ${this.appKey}`)
      this.status = 'connected'
      this.scheduleTokenRefresh()

      // Start the Stream API connection for receiving messages
      this.startStream()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[DingTalk] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    if (this.streamReconnectTimer) {
      clearTimeout(this.streamReconnectTimer)
      this.streamReconnectTimer = null
    }
    this.streamAbort?.abort()
    this.streamAbort = null
    this.accessToken = ''
    this.status = 'disconnected'
    console.log('[DingTalk] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    await this.ensureToken()

    // Determine format: use Markdown if the message requests it
    const useMarkdown = message.format === 'markdown'
    const text = message.text.slice(0, MAX_MESSAGE_LENGTH)

    // If channelId looks like a webhook URL, use webhook mode
    if (channelId.startsWith('https://')) {
      return this.sendViaWebhook(channelId, text, useMarkdown)
    }

    // Otherwise, use the robot message API to send to a conversation
    const body: Record<string, unknown> = {
      robotCode: this.robotCode || this.appKey,
      userIds: [channelId],
      msgKey: useMarkdown ? 'sampleMarkdown' : 'sampleText',
      msgParam: useMarkdown
        ? JSON.stringify({ title: 'Message', text })
        : JSON.stringify({ content: text }),
    }

    const res = await fetch(`${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`, {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': this.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`DingTalk send failed: ${res.status} ${errText}`)
    }

    const result = (await res.json()) as { processQueryKey?: string }
    return result.processQueryKey ?? `msg_${Date.now()}`
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'DingTalk',
      description: 'DingTalk Robot adapter with webhook and Stream API support',
      requiredCredentials: ['app_key', 'app_secret', 'robot_code'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Webhook Sending ──────────────────────────────────────────

  private async sendViaWebhook(webhookUrl: string, text: string, markdown: boolean): Promise<string> {
    const body = markdown
      ? { msgtype: 'markdown', markdown: { title: 'Message', text } }
      : { msgtype: 'text', text: { content: text } }

    // Sign the request if app_secret is available
    const timestamp = String(Date.now())
    const stringToSign = `${timestamp}\n${this.appSecret}`
    const sign = crypto.createHmac('sha256', this.appSecret)
      .update(stringToSign)
      .digest('base64')

    const url = new URL(webhookUrl)
    url.searchParams.set('timestamp', timestamp)
    url.searchParams.set('sign', sign)

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`DingTalk webhook send failed: ${res.status} ${errText}`)
    }

    const result = (await res.json()) as { errcode?: number; errmsg?: string }
    if (result.errcode && result.errcode !== 0) {
      throw new Error(`DingTalk webhook error: ${result.errcode} ${result.errmsg}`)
    }

    return `webhook_${Date.now()}`
  }

  // ── Callback Webhook Routes ──────────────────────────────────

  private setupRoutes(): void {
    this.webhookRouter.post('/', async (req: Request, res: Response) => {
      try {
        // Verify DingTalk callback signature
        const timestamp = req.headers['timestamp'] as string
        const sign = req.headers['sign'] as string

        if (timestamp && sign && this.appSecret) {
          const stringToSign = `${timestamp}\n${this.appSecret}`
          const expectedSign = crypto.createHmac('sha256', this.appSecret)
            .update(stringToSign)
            .digest('base64')

          if (sign !== expectedSign) {
            res.sendStatus(403)
            return
          }
        }

        res.status(200).json({ msgtype: 'empty' })

        const body = req.body as DingTalkCallbackMessage
        if (body.text?.content || body.msgtype === 'text') {
          await this.handleCallbackMessage(body)
        }
      } catch (err) {
        console.error(`[DingTalk] Webhook error: ${(err as Error).message}`)
        if (!res.headersSent) res.status(200).json({ msgtype: 'empty' })
      }
    })
  }

  private async handleCallbackMessage(msg: DingTalkCallbackMessage): Promise<void> {
    if (this.status !== 'connected') return

    const userId = msg.senderStaffId ?? msg.senderId ?? ''
    const userName = msg.senderNick ?? userId

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

    const text = msg.text?.content?.trim() ?? ''
    if (!text) return

    const incoming: IncomingMessage = {
      platform: 'dingtalk',
      platformUserId: userId,
      platformUserName: userName,
      channelId: msg.conversationId ?? userId,
      messageId: msg.msgId ?? String(Date.now()),
      text,
      timestamp: new Date(parseInt(msg.createAt ?? String(Date.now()), 10)),
      raw: msg,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[DingTalk] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Stream API ───────────────────────────────────────────────

  private async startStream(): Promise<void> {
    this.streamAbort = new AbortController()

    try {
      // Register stream connection endpoint
      const regRes = await fetch(`${DINGTALK_API}/v1.0/gateway/connections/open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: this.appKey,
          clientSecret: this.appSecret,
          subscriptions: [{ type: 'EVENT', topic: '/v1.0/im/bot/messages/get' }],
        }),
        signal: this.streamAbort.signal,
      })

      if (!regRes.ok) {
        console.warn(`[DingTalk] Stream registration failed: ${regRes.status} — falling back to webhook mode`)
        return
      }

      const regData = (await regRes.json()) as { endpoint?: string; ticket?: string }
      if (regData.endpoint && regData.ticket) {
        console.log('[DingTalk] Stream connection registered, connecting...')
        this.pollStream(regData.endpoint, regData.ticket)
      } else {
        console.warn('[DingTalk] Stream response missing endpoint/ticket — using webhook mode')
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      console.warn(`[DingTalk] Stream connection error: ${(err as Error).message} — using webhook mode`)
    }
  }

  private async pollStream(endpoint: string, ticket: string): Promise<void> {
    while (this.streamAbort && !this.streamAbort.signal.aborted) {
      try {
        const url = `${endpoint}?ticket=${encodeURIComponent(ticket)}`
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: this.streamAbort.signal,
        })

        if (!res.ok) {
          console.error(`[DingTalk] Stream poll error: ${res.status}`)
          await sleep(5000)
          continue
        }

        const events = (await res.json()) as DingTalkStreamEvent[]
        if (Array.isArray(events)) {
          for (const event of events) {
            if (event.type === 'EVENT' && event.data) {
              try {
                const msgData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
                await this.handleCallbackMessage(msgData as DingTalkCallbackMessage)
              } catch (parseErr) {
                console.error(`[DingTalk] Stream event parse error: ${(parseErr as Error).message}`)
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error(`[DingTalk] Stream error: ${(err as Error).message}`)
        await sleep(5000)
      }
    }
  }

  // ── Access Token ─────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: this.appKey,
        appSecret: this.appSecret,
      }),
    })

    if (!res.ok) {
      throw new Error(`Token fetch failed: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { accessToken?: string; expireIn?: number }

    if (!data.accessToken) {
      throw new Error('No accessToken in response')
    }

    this.accessToken = data.accessToken
    this.tokenExpiresAt = Date.now() + (data.expireIn ?? 7200) * 1000
    console.log(`[DingTalk] Access token refreshed, expires in ${data.expireIn ?? 7200}s`)
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)

    const refreshIn = Math.max((this.tokenExpiresAt - Date.now()) - 300_000, 60_000)
    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshAccessToken()
        this.scheduleTokenRefresh()
      } catch (err) {
        console.error(`[DingTalk] Token refresh error: ${(err as Error).message}`)
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── DingTalk-specific types ──────────────────────────────────────

interface DingTalkCallbackMessage {
  msgId?: string
  msgtype?: string
  text?: { content: string }
  senderId?: string
  senderStaffId?: string
  senderNick?: string
  conversationId?: string
  conversationType?: string
  createAt?: string
  chatbotUserId?: string
  senderCorpId?: string
}

interface DingTalkStreamEvent {
  type: string
  topic?: string
  headers?: Record<string, string>
  data?: unknown
}
