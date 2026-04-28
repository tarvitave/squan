/**
 * WeCom (WeChat Work / Enterprise WeChat) Adapter
 *
 * Receives messages via callback URL webhook and sends via the
 * qyapi.weixin.qq.com message/send API. Access token auto-refreshes.
 * Exports a webhookRouter for Express mounting at /gateway/wecom.
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

const WECOM_API = 'https://qyapi.weixin.qq.com/cgi-bin'
const MAX_MESSAGE_LENGTH = 2048

export class WeComAdapter implements PlatformAdapter {
  readonly platform = 'wecom' as const
  status: AdapterStatus = 'disconnected'

  private corpId = ''
  private corpSecret = ''
  private agentId = ''
  private callbackToken = ''
  private encodingAesKey = ''
  private aesKey: Buffer | null = null
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Access token management
  private accessToken = ''
  private tokenExpiresAt = 0
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

  /** Express router — mount at /gateway/wecom on your app */
  readonly webhookRouter: Router = Router()

  constructor() {
    this.setupRoutes()
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.corpId = config.credentials.corp_id ?? ''
    this.corpSecret = config.credentials.corp_secret ?? ''
    this.agentId = config.credentials.agent_id ?? ''
    this.callbackToken = config.credentials.token ?? ''
    this.encodingAesKey = config.credentials.encoding_aes_key ?? ''

    if (!this.corpId) throw new Error('WeCom adapter requires corp_id credential')
    if (!this.corpSecret) throw new Error('WeCom adapter requires corp_secret credential')
    if (!this.agentId) throw new Error('WeCom adapter requires agent_id credential')

    // Decode AES key (base64 encoded, 43 chars → 32 bytes)
    if (this.encodingAesKey) {
      this.aesKey = Buffer.from(this.encodingAesKey + '=', 'base64')
    }

    this.status = 'connecting'

    try {
      await this.refreshAccessToken()
      console.log(`[WeCom] Connected with corp ID: ${this.corpId}, agent: ${this.agentId}`)
      this.status = 'connected'
      this.scheduleTokenRefresh()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[WeCom] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    this.accessToken = ''
    this.status = 'disconnected'
    console.log('[WeCom] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    await this.ensureToken()
    const text = message.text.slice(0, MAX_MESSAGE_LENGTH)

    // channelId is the user ID in WeCom
    const body = {
      touser: channelId,
      msgtype: 'text',
      agentid: parseInt(this.agentId, 10),
      text: { content: text },
    }

    const res = await fetch(
      `${WECOM_API}/message/send?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`WeCom send failed: ${res.status} ${errText}`)
    }

    const result = (await res.json()) as { errcode: number; errmsg: string; msgid?: string }
    if (result.errcode !== 0) {
      throw new Error(`WeCom send error: ${result.errcode} ${result.errmsg}`)
    }

    return result.msgid ?? `msg_${Date.now()}`
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'WeCom',
      description: 'WeCom (WeChat Work) adapter with callback webhook and auto-refreshing token',
      requiredCredentials: ['corp_id', 'corp_secret', 'agent_id', 'token', 'encoding_aes_key'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Webhook Routes ───────────────────────────────────────────

  private setupRoutes(): void {
    // URL verification (GET)
    this.webhookRouter.get('/', (req: Request, res: Response) => {
      const msgSignature = req.query.msg_signature as string
      const timestamp = req.query.timestamp as string
      const nonce = req.query.nonce as string
      const echostr = req.query.echostr as string

      if (!this.verifySignature(msgSignature, timestamp, nonce, echostr)) {
        res.sendStatus(403)
        return
      }

      // Decrypt echostr
      const decrypted = this.decryptMessage(echostr)
      if (decrypted) {
        console.log('[WeCom] Webhook verification successful')
        res.status(200).send(decrypted)
      } else {
        res.sendStatus(403)
      }
    })

    // Incoming messages (POST) — encrypted XML
    this.webhookRouter.post('/', async (req: Request, res: Response) => {
      try {
        const msgSignature = req.query.msg_signature as string
        const timestamp = req.query.timestamp as string
        const nonce = req.query.nonce as string

        const xmlBody = typeof req.body === 'string' ? req.body : String(req.body)

        // Extract encrypted message from XML
        const encryptedMsg = this.extractXmlTag(xmlBody, 'Encrypt')
        if (!encryptedMsg) {
          res.status(200).send('success')
          return
        }

        // Verify signature
        if (!this.verifySignature(msgSignature, timestamp, nonce, encryptedMsg)) {
          res.sendStatus(403)
          return
        }

        // Decrypt
        const decryptedXml = this.decryptMessage(encryptedMsg)
        if (!decryptedXml) {
          res.status(200).send('success')
          return
        }

        // Parse the decrypted XML
        const msg = this.parseXml(decryptedXml)

        // Respond immediately
        res.status(200).send('success')

        if (msg.MsgType === 'text' && msg.Content) {
          await this.handleMessage(msg)
        }
      } catch (err) {
        console.error(`[WeCom] Webhook error: ${(err as Error).message}`)
        if (!res.headersSent) res.status(200).send('success')
      }
    })
  }

  private async handleMessage(msg: Record<string, string>): Promise<void> {
    if (this.status !== 'connected') return

    const userId = msg.FromUserName ?? ''
    const userName = msg.FromUserName ?? 'unknown'

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

    const incoming: IncomingMessage = {
      platform: 'wecom',
      platformUserId: userId,
      platformUserName: userName,
      channelId: userId,
      messageId: msg.MsgId ?? String(Date.now()),
      text: msg.Content ?? '',
      timestamp: new Date(parseInt(msg.CreateTime ?? '0', 10) * 1000),
      raw: msg,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[WeCom] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Signature Verification ───────────────────────────────────

  private verifySignature(signature: string, timestamp: string, nonce: string, encrypt: string): boolean {
    if (!signature || !timestamp || !nonce) return false
    const arr = [this.callbackToken, timestamp, nonce, encrypt].sort()
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex')
    return hash === signature
  }

  // ── AES Encryption/Decryption ────────────────────────────────

  private decryptMessage(encrypted: string): string | null {
    if (!this.aesKey) {
      console.warn('[WeCom] No AES key configured, cannot decrypt')
      return null
    }

    try {
      const iv = this.aesKey.subarray(0, 16)
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, iv)
      decipher.setAutoPadding(false)

      const encBuf = Buffer.from(encrypted, 'base64')
      let decrypted = Buffer.concat([decipher.update(encBuf), decipher.final()])

      // Remove PKCS7 padding
      const padLen = decrypted[decrypted.length - 1]
      decrypted = decrypted.subarray(0, decrypted.length - padLen)

      // Skip 16 bytes random prefix
      // Next 4 bytes = content length (big-endian)
      const contentLen = decrypted.readUInt32BE(16)
      const content = decrypted.subarray(20, 20 + contentLen).toString('utf-8')

      // Remaining bytes after content = corp ID (for verification)
      const corpId = decrypted.subarray(20 + contentLen).toString('utf-8')
      if (corpId !== this.corpId) {
        console.warn(`[WeCom] Corp ID mismatch: expected ${this.corpId}, got ${corpId}`)
        return null
      }

      return content
    } catch (err) {
      console.error(`[WeCom] Decryption error: ${(err as Error).message}`)
      return null
    }
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

  private extractXmlTag(xml: string, tag: string): string | null {
    const cdataRegex = new RegExp(`<${tag}><!\\\[CDATA\\\[(.*?)\\\]\\\]></${tag}>`, 's')
    const plainRegex = new RegExp(`<${tag}>(.*?)</${tag}>`, 's')
    const cdataMatch = xml.match(cdataRegex)
    if (cdataMatch) return cdataMatch[1]
    const plainMatch = xml.match(plainRegex)
    return plainMatch?.[1] ?? null
  }

  // ── Access Token ─────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const url = `${WECOM_API}/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`
    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`Token fetch failed: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`WeCom token error: ${data.errcode} ${data.errmsg}`)
    }

    if (!data.access_token) {
      throw new Error('No access_token in response')
    }

    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 7200) * 1000
    console.log(`[WeCom] Access token refreshed, expires in ${data.expires_in ?? 7200}s`)
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)

    const refreshIn = Math.max((this.tokenExpiresAt - Date.now()) - 300_000, 60_000)
    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshAccessToken()
        this.scheduleTokenRefresh()
      } catch (err) {
        console.error(`[WeCom] Token refresh error: ${(err as Error).message}`)
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
