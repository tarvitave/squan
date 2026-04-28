/**
 * WeChat Official Account Adapter
 *
 * Receives messages via XML webhook callback and responds within 5 seconds.
 * Uses the WeChat Official Account API for proactive message sending.
 * Signature verification via SHA1(sort(token, timestamp, nonce)).
 * Exports a webhookRouter for Express mounting at /gateway/wechat.
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

const WECHAT_API = 'https://api.weixin.qq.com/cgi-bin'
const MAX_MESSAGE_LENGTH = 2048

export class WeChatAdapter implements PlatformAdapter {
  readonly platform = 'wechat' as const
  status: AdapterStatus = 'disconnected'

  private appId = ''
  private appSecret = ''
  private token = ''
  private encodingAesKey = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Access token management
  private accessToken = ''
  private tokenExpiresAt = 0
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

  // Pending replies: the webhook handler can wait for a quick reply
  private pendingReplies = new Map<string, { resolve: (xml: string) => void; timer: ReturnType<typeof setTimeout> }>()

  /** Express router — mount at /gateway/wechat on your app */
  readonly webhookRouter: Router = Router()

  constructor() {
    this.setupRoutes()
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.appId = config.credentials.app_id ?? ''
    this.appSecret = config.credentials.app_secret ?? ''
    this.token = config.credentials.token ?? ''
    this.encodingAesKey = config.credentials.encoding_aes_key ?? ''

    if (!this.appId) throw new Error('WeChat adapter requires app_id credential')
    if (!this.appSecret) throw new Error('WeChat adapter requires app_secret credential')
    if (!this.token) throw new Error('WeChat adapter requires token credential')

    this.status = 'connecting'

    try {
      await this.refreshAccessToken()
      console.log(`[WeChat] Connected with app ID: ${this.appId}`)
      this.status = 'connected'
      this.scheduleTokenRefresh()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[WeChat] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    // Resolve any pending replies
    for (const [key, pending] of this.pendingReplies) {
      clearTimeout(pending.timer)
      pending.resolve('')
      this.pendingReplies.delete(key)
    }
    this.accessToken = ''
    this.status = 'disconnected'
    console.log('[WeChat] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    // Check if there's a pending webhook reply waiting
    const pending = this.pendingReplies.get(channelId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingReplies.delete(channelId)
      // Send as passive reply XML (no access token needed)
      const xml = this.buildReplyXml(channelId, this.appId, message.text)
      pending.resolve(xml)
      return `reply_${Date.now()}`
    }

    // Otherwise send proactively via customer service message API
    await this.ensureToken()
    const text = message.text.slice(0, MAX_MESSAGE_LENGTH)

    const body = {
      touser: channelId,
      msgtype: 'text',
      text: { content: text },
    }

    const res = await fetch(
      `${WECHAT_API}/message/custom/send?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`WeChat send failed: ${res.status} ${errText}`)
    }

    const result = (await res.json()) as { errcode: number; errmsg: string }
    if (result.errcode !== 0) {
      throw new Error(`WeChat send error: ${result.errcode} ${result.errmsg}`)
    }

    return `msg_${Date.now()}`
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'WeChat',
      description: 'WeChat Official Account adapter with XML webhook support',
      requiredCredentials: ['app_id', 'app_secret', 'token', 'encoding_aes_key'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Webhook Routes ───────────────────────────────────────────

  private setupRoutes(): void {
    // Signature verification (GET) — WeChat server verification
    this.webhookRouter.get('/', (req: Request, res: Response) => {
      const signature = req.query.signature as string
      const timestamp = req.query.timestamp as string
      const nonce = req.query.nonce as string
      const echostr = req.query.echostr as string

      if (this.verifySignature(signature, timestamp, nonce)) {
        console.log('[WeChat] Webhook verification successful')
        res.status(200).send(echostr)
      } else {
        console.warn('[WeChat] Webhook verification failed')
        res.sendStatus(403)
      }
    })

    // Incoming messages (POST) — XML payloads
    this.webhookRouter.post('/', async (req: Request, res: Response) => {
      try {
        // Verify signature
        const signature = req.query.signature as string
        const timestamp = req.query.timestamp as string
        const nonce = req.query.nonce as string

        if (!this.verifySignature(signature, timestamp, nonce)) {
          res.sendStatus(403)
          return
        }

        // Parse XML body (Express should have a raw/text body parser configured)
        const xmlBody = typeof req.body === 'string' ? req.body : String(req.body)
        const msg = this.parseXml(xmlBody)

        if (!msg || msg.MsgType !== 'text') {
          res.status(200).send('success')
          return
        }

        // Create a pending reply slot — we can respond within 5 seconds
        const replyPromise = new Promise<string>((resolve) => {
          const timer = setTimeout(() => {
            this.pendingReplies.delete(msg.FromUserName)
            resolve('') // Timeout — send empty response, will use proactive API later
          }, 4500) // 4.5s to leave margin

          this.pendingReplies.set(msg.FromUserName, { resolve, timer })
        })

        // Dispatch to handler (async)
        const incoming: IncomingMessage = {
          platform: 'wechat',
          platformUserId: msg.FromUserName,
          platformUserName: msg.FromUserName,
          channelId: msg.FromUserName,
          messageId: msg.MsgId ?? String(Date.now()),
          text: msg.Content ?? '',
          timestamp: new Date(parseInt(msg.CreateTime ?? '0', 10) * 1000),
          raw: msg,
        }

        // Access control
        const allowed = this.config?.settings.allowedUsers
        if (allowed && allowed.length > 0 && !allowed.includes(msg.FromUserName)) {
          this.pendingReplies.delete(msg.FromUserName)
          res.status(200).send('success')
          return
        }

        // Process in parallel, waiting for reply
        this.messageHandler?.(incoming).catch((err) =>
          console.error(`[WeChat] Message handler error: ${(err as Error).message}`),
        )

        const replyXml = await replyPromise
        if (replyXml) {
          res.set('Content-Type', 'application/xml')
          res.status(200).send(replyXml)
        } else {
          res.status(200).send('success')
        }
      } catch (err) {
        console.error(`[WeChat] Webhook error: ${(err as Error).message}`)
        if (!res.headersSent) res.status(200).send('success')
      }
    })
  }

  // ── Signature Verification ───────────────────────────────────

  private verifySignature(signature: string, timestamp: string, nonce: string): boolean {
    if (!signature || !timestamp || !nonce) return false

    const arr = [this.token, timestamp, nonce].sort()
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex')
    return hash === signature
  }

  // ── XML Helpers ──────────────────────────────────────────────

  private parseXml(xml: string): Record<string, string> {
    const result: Record<string, string> = {}
    const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(.*?)<\/\3>/gs
    let match: RegExpExecArray | null

    while ((match = tagRegex.exec(xml)) !== null) {
      const key = match[1] || match[3]
      const value = match[2] ?? match[4] ?? ''
      result[key] = value
    }

    return result
  }

  private buildReplyXml(toUser: string, fromUser: string, content: string): string {
    const timestamp = Math.floor(Date.now() / 1000)
    return `<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${timestamp}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content.slice(0, MAX_MESSAGE_LENGTH)}]]></Content>
</xml>`
  }

  // ── Access Token ─────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const url = `${WECHAT_API}/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`
    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`Token fetch failed: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`WeChat token error: ${data.errcode} ${data.errmsg}`)
    }

    if (!data.access_token) {
      throw new Error('No access_token in response')
    }

    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 7200) * 1000
    console.log(`[WeChat] Access token refreshed, expires in ${data.expires_in ?? 7200}s`)
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)

    const refreshIn = Math.max((this.tokenExpiresAt - Date.now()) - 300_000, 60_000)
    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshAccessToken()
        this.scheduleTokenRefresh()
      } catch (err) {
        console.error(`[WeChat] Token refresh error: ${(err as Error).message}`)
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
