/**
 * WhatsApp Cloud API Adapter
 *
 * Webhook-based: registers an Express sub-router for receiving messages.
 * Sends messages via the Meta Graph API.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'
import { Router, type Request, type Response } from 'express'

const GRAPH_API = 'https://graph.facebook.com/v18.0'
const MAX_MESSAGE_LENGTH = 4096

export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = 'whatsapp' as const
  status: AdapterStatus = 'disconnected'

  private accessToken = ''
  private phoneNumberId = ''
  private verifyToken = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  /** Express router — mount at /gateway/whatsapp on your app */
  readonly router: Router = Router()

  // Track processed message IDs to avoid duplicates
  private processedMessages = new Set<string>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.setupRoutes()
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.accessToken = config.credentials.access_token
    this.phoneNumberId = config.credentials.phone_number_id
    this.verifyToken = config.credentials.verify_token ?? 'squan_verify'

    if (!this.accessToken) throw new Error('WhatsApp adapter requires access_token credential')
    if (!this.phoneNumberId) throw new Error('WhatsApp adapter requires phone_number_id credential')

    this.status = 'connecting'

    try {
      // Verify credentials by fetching phone number info
      const res = await fetch(`${GRAPH_API}/${this.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`API verification failed: ${res.status} ${text}`)
      }
      const data = (await res.json()) as { display_phone_number?: string }
      console.log(`[WhatsApp] Connected with phone: ${data.display_phone_number ?? this.phoneNumberId}`)

      this.status = 'connected'

      // Periodic cleanup of processed message cache
      this.cleanupInterval = setInterval(() => {
        this.processedMessages.clear()
      }, 10 * 60 * 1000) // Clear every 10 minutes
    } catch (err) {
      this.status = 'error'
      throw new Error(`[WhatsApp] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.processedMessages.clear()
    this.status = 'disconnected'
    console.log('[WhatsApp] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = message.text
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastMessageId = ''

    for (const chunk of chunks) {
      const body: WhatsAppOutgoing = {
        messaging_product: 'whatsapp',
        to: channelId,
        type: 'text',
        text: { body: chunk },
      }

      // Reply context
      if (message.replyTo && lastMessageId === '') {
        body.context = { message_id: message.replyTo }
      }

      const result = await this.apiCall<{ messages: Array<{ id: string }> }>(
        `${this.phoneNumberId}/messages`,
        body,
      )
      lastMessageId = result.messages?.[0]?.id ?? ''
    }

    return lastMessageId
  }

  // WhatsApp doesn't support message editing or reactions via Cloud API
  // (reactions are supported but we'll add it)
  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    await this.apiCall(`${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: channelId,
      type: 'reaction',
      reaction: { message_id: messageId, emoji },
    })
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'WhatsApp',
      description: 'WhatsApp Business Cloud API adapter with webhook support',
      requiredCredentials: ['access_token', 'phone_number_id', 'verify_token'],
      optionalSettings: ['allowedUsers', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Webhook Routes ───────────────────────────────────────────

  private setupRoutes(): void {
    // Webhook verification (GET)
    this.router.get('/webhook', (req: Request, res: Response) => {
      const mode = req.query['hub.mode'] as string
      const token = req.query['hub.verify_token'] as string
      const challenge = req.query['hub.challenge'] as string

      if (mode === 'subscribe' && token === this.verifyToken) {
        console.log('[WhatsApp] Webhook verified')
        res.status(200).send(challenge)
      } else {
        console.warn('[WhatsApp] Webhook verification failed')
        res.sendStatus(403)
      }
    })

    // Incoming messages (POST)
    this.router.post('/webhook', (req: Request, res: Response) => {
      // Always respond 200 quickly to avoid retries
      res.sendStatus(200)

      try {
        const body = req.body as WhatsAppWebhookPayload
        this.processWebhook(body).catch((err) =>
          console.error(`[WhatsApp] Webhook processing error: ${(err as Error).message}`),
        )
      } catch (err) {
        console.error(`[WhatsApp] Webhook parse error: ${(err as Error).message}`)
      }
    })
  }

  private async processWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    if (this.status !== 'connected') return

    const entries = payload.entry ?? []
    for (const entry of entries) {
      const changes = entry.changes ?? []
      for (const change of changes) {
        if (change.field !== 'messages') continue

        const value = change.value
        const messages = value?.messages ?? []
        const contacts = value?.contacts ?? []

        for (const msg of messages) {
          // Deduplicate
          if (this.processedMessages.has(msg.id)) continue
          this.processedMessages.add(msg.id)

          // Only handle text messages for now
          if (msg.type !== 'text' || !msg.text?.body) continue

          // Access control
          const allowed = this.config?.settings.allowedUsers
          if (allowed && allowed.length > 0 && !allowed.includes(msg.from)) continue

          // Resolve contact name
          const contact = contacts.find((c) => c.wa_id === msg.from)
          const userName = contact?.profile?.name ?? msg.from

          const incoming: IncomingMessage = {
            platform: 'whatsapp',
            platformUserId: msg.from,
            platformUserName: userName,
            channelId: msg.from, // In WhatsApp, the "channel" is the user's phone number
            messageId: msg.id,
            text: msg.text.body,
            replyTo: msg.context?.id,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000),
            raw: msg,
          }

          await this.messageHandler?.(incoming)
        }
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private async apiCall<T = unknown>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${GRAPH_API}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`WhatsApp API ${endpoint}: ${res.status} ${text}`)
    }

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

// ── WhatsApp-specific types ──────────────────────────────────────

interface WhatsAppOutgoing {
  [key: string]: unknown
  messaging_product: 'whatsapp'
  to: string
  type: string
  text?: { body: string }
  context?: { message_id: string }
  reaction?: { message_id: string; emoji: string }
}

interface WhatsAppWebhookPayload {
  object?: string
  entry?: Array<{
    id: string
    changes?: Array<{
      field: string
      value?: {
        messaging_product?: string
        metadata?: { phone_number_id: string }
        contacts?: Array<{
          wa_id: string
          profile?: { name: string }
        }>
        messages?: Array<{
          id: string
          from: string
          timestamp: string
          type: string
          text?: { body: string }
          context?: { id: string }
        }>
      }
    }>
  }>
}
