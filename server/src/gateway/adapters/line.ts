/**
 * LINE Messaging API Adapter
 *
 * Receives messages via webhook at /gateway/line/webhook with HMAC-SHA256
 * signature verification. Sends messages via the LINE push/reply API.
 * Exports a webhookRouter for Express mounting at /gateway/line.
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

const LINE_API = 'https://api.line.me/v2/bot'
const MAX_MESSAGE_LENGTH = 5000

export class LINEAdapter implements PlatformAdapter {
  readonly platform = 'line' as const
  status: AdapterStatus = 'disconnected'

  private channelAccessToken = ''
  private channelSecret = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Store reply tokens briefly for responding to webhook events
  private replyTokens = new Map<string, { token: string; timer: ReturnType<typeof setTimeout> }>()

  /** Express router — mount at /gateway/line on your app */
  readonly webhookRouter: Router = Router()

  constructor() {
    this.setupRoutes()
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.channelAccessToken = config.credentials.channel_access_token ?? ''
    this.channelSecret = config.credentials.channel_secret ?? ''

    if (!this.channelAccessToken) throw new Error('LINE adapter requires channel_access_token credential')
    if (!this.channelSecret) throw new Error('LINE adapter requires channel_secret credential')

    this.status = 'connecting'

    try {
      // Verify credentials by fetching bot info
      const res = await fetch(`${LINE_API}/info`, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`API verification failed: ${res.status} ${errText}`)
      }

      const botInfo = (await res.json()) as { userId?: string; displayName?: string; basicId?: string }
      console.log(`[LINE] Connected as ${botInfo.displayName ?? 'bot'} (${botInfo.basicId ?? botInfo.userId ?? 'unknown'})`)

      this.status = 'connected'
    } catch (err) {
      this.status = 'error'
      throw new Error(`[LINE] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    // Clear any pending reply tokens
    for (const [key, entry] of this.replyTokens) {
      clearTimeout(entry.timer)
      this.replyTokens.delete(key)
    }
    this.status = 'disconnected'
    console.log('[LINE] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = message.text
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastMessageId = ''

    // Check if we have a reply token for this channel (from a recent webhook event)
    const replyEntry = this.replyTokens.get(channelId)
    if (replyEntry && chunks.length <= 5) {
      // Use reply API (free, up to 5 messages)
      clearTimeout(replyEntry.timer)
      this.replyTokens.delete(channelId)

      const messages = chunks.map((chunk) => ({
        type: 'text' as const,
        text: chunk,
      }))

      const res = await fetch(`${LINE_API}/message/reply`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          replyToken: replyEntry.token,
          messages,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.warn(`[LINE] Reply failed (${res.status}), falling back to push: ${errText}`)
        // Fall through to push API below
      } else {
        const result = (await res.json()) as { sentMessages?: Array<{ id: string }> }
        return result.sentMessages?.[0]?.id ?? `reply_${Date.now()}`
      }
    }

    // Use push API (costs messaging fee per message)
    for (const chunk of chunks) {
      const messages = [{ type: 'text' as const, text: chunk }]

      const res = await fetch(`${LINE_API}/message/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: channelId,
          messages,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`LINE push failed: ${res.status} ${errText}`)
      }

      const result = (await res.json()) as { sentMessages?: Array<{ id: string }> }
      lastMessageId = result.sentMessages?.[0]?.id ?? `push_${Date.now()}`
    }

    return lastMessageId
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'LINE',
      description: 'LINE Messaging API adapter with HMAC-SHA256 webhook verification',
      requiredCredentials: ['channel_access_token', 'channel_secret'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Webhook Routes ───────────────────────────────────────────

  private setupRoutes(): void {
    this.webhookRouter.post('/webhook', async (req: Request, res: Response) => {
      try {
        // Verify signature
        const signature = req.headers['x-line-signature'] as string
        if (!this.verifySignature(req.body, signature)) {
          console.warn('[LINE] Invalid webhook signature')
          res.sendStatus(403)
          return
        }

        // Respond 200 immediately
        res.sendStatus(200)

        const body = typeof req.body === 'string'
          ? JSON.parse(req.body) as LINEWebhookBody
          : req.body as LINEWebhookBody

        await this.processWebhook(body)
      } catch (err) {
        console.error(`[LINE] Webhook error: ${(err as Error).message}`)
        if (!res.headersSent) res.sendStatus(200)
      }
    })
  }

  private verifySignature(body: unknown, signature: string): boolean {
    if (!signature) return false

    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
    const hash = crypto
      .createHmac('sha256', this.channelSecret)
      .update(bodyStr)
      .digest('base64')

    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(signature),
    )
  }

  private async processWebhook(body: LINEWebhookBody): Promise<void> {
    if (this.status !== 'connected') return

    for (const event of body.events ?? []) {
      switch (event.type) {
        case 'message':
          await this.handleMessageEvent(event)
          break
        case 'follow':
          console.log(`[LINE] New follower: ${event.source?.userId ?? 'unknown'}`)
          break
        case 'unfollow':
          console.log(`[LINE] Unfollowed by: ${event.source?.userId ?? 'unknown'}`)
          break
        case 'join':
          console.log(`[LINE] Joined group: ${event.source?.groupId ?? event.source?.roomId ?? 'unknown'}`)
          break
      }
    }
  }

  private async handleMessageEvent(event: LINEEvent): Promise<void> {
    if (!event.message || event.message.type !== 'text') return

    const userId = event.source?.userId ?? ''

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

    // Determine channel ID: group > room > user
    const channelId = event.source?.groupId ?? event.source?.roomId ?? userId

    // Store reply token for quick responses (valid for ~1 minute)
    if (event.replyToken) {
      const existing = this.replyTokens.get(channelId)
      if (existing) clearTimeout(existing.timer)

      const timer = setTimeout(() => this.replyTokens.delete(channelId), 55_000)
      this.replyTokens.set(channelId, { token: event.replyToken, timer })
    }

    const incoming: IncomingMessage = {
      platform: 'line',
      platformUserId: userId,
      platformUserName: userId, // LINE doesn't provide name in webhook; would need profile API
      channelId,
      messageId: event.message.id ?? String(Date.now()),
      text: event.message.text ?? '',
      timestamp: new Date(event.timestamp ?? Date.now()),
      raw: event,
    }

    // Try to fetch display name
    if (userId) {
      try {
        const profileRes = await fetch(`${LINE_API}/profile/${userId}`, {
          headers: { Authorization: `Bearer ${this.channelAccessToken}` },
        })
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { displayName?: string }
          incoming.platformUserName = profile.displayName ?? userId
        }
      } catch {
        // Non-critical — use userId as fallback
      }
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[LINE] Message handler error: ${(err as Error).message}`)
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

// ── LINE-specific types ──────────────────────────────────────────

interface LINEWebhookBody {
  destination?: string
  events?: LINEEvent[]
}

interface LINEEvent {
  type: string
  replyToken?: string
  timestamp?: number
  source?: {
    type: string
    userId?: string
    groupId?: string
    roomId?: string
  }
  message?: {
    id?: string
    type: string
    text?: string
  }
}
