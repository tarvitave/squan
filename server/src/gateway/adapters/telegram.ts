/**
 * Telegram Bot API Adapter
 *
 * Uses long polling via getUpdates to receive messages.
 * Sends via the Telegram Bot HTTP API with MarkdownV2 formatting.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'

const TELEGRAM_API = 'https://api.telegram.org'
const MAX_MESSAGE_LENGTH = 4096

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const
  status: AdapterStatus = 'disconnected'

  private token = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private pollingAbort: AbortController | null = null
  private pollOffset = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private botUsername = ''

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.token = config.credentials.bot_token
    if (!this.token) throw new Error('Telegram adapter requires bot_token credential')

    this.status = 'connecting'

    try {
      // Verify token by calling getMe
      const me = await this.apiCall<{ id: number; username: string }>('getMe')
      this.botUsername = me.username ?? ''
      console.log(`[Telegram] Connected as @${this.botUsername}`)

      // Delete any existing webhook so long-polling works
      await this.apiCall('deleteWebhook')

      this.status = 'connected'
      this.startPolling()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Telegram] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.status = 'disconnected'
    console.log('[Telegram] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = this.formatOutgoing(message)
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastMessageId = ''

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        chat_id: channelId,
        text: chunk,
        parse_mode: message.format === 'markdown' || message.format === 'html' ? 'MarkdownV2' : undefined,
      }
      if (message.replyTo && lastMessageId === '') {
        body.reply_to_message_id = Number(message.replyTo)
      }

      const result = await this.apiCall<{ message_id: number }>('sendMessage', body)
      lastMessageId = String(result.message_id)
    }

    return lastMessageId
  }

  async edit(messageId: string, channelId: string, message: OutgoingMessage): Promise<void> {
    const text = this.formatOutgoing(message)
    await this.apiCall('editMessageText', {
      chat_id: channelId,
      message_id: Number(messageId),
      text: text.slice(0, MAX_MESSAGE_LENGTH),
      parse_mode: message.format === 'markdown' ? 'MarkdownV2' : undefined,
    })
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    await this.apiCall('setMessageReaction', {
      chat_id: channelId,
      message_id: Number(messageId),
      reaction: [{ type: 'emoji', emoji }],
    })
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Telegram',
      description: 'Telegram Bot API adapter using long polling',
      requiredCredentials: ['bot_token'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Long Polling ─────────────────────────────────────────────

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
        const updates = await this.apiCall<TelegramUpdate[]>('getUpdates', {
          offset: this.pollOffset,
          timeout: 30,
          allowed_updates: ['message'],
        }, this.pollingAbort.signal)

        for (const update of updates) {
          if (update.update_id >= this.pollOffset) {
            this.pollOffset = update.update_id + 1
          }
          if (update.message) {
            await this.handleUpdate(update.message)
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error(`[Telegram] Polling error: ${(err as Error).message}`)
        // Back off before retrying
        await sleep(5000)
      }
    }
  }

  private async handleUpdate(msg: TelegramMessage): Promise<void> {
    if (!msg.text) return

    // Access control
    const userId = String(msg.from?.id ?? '')
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

    // Handle /start command
    if (msg.text === '/start') {
      await this.apiCall('sendMessage', {
        chat_id: msg.chat.id,
        text: '👋 Hello! I\'m connected to Squan. Send me a message to get started.',
      })
      return
    }

    const incoming: IncomingMessage = {
      platform: 'telegram',
      platformUserId: userId,
      platformUserName: msg.from?.username ?? msg.from?.first_name ?? 'unknown',
      channelId: String(msg.chat.id),
      messageId: String(msg.message_id),
      text: msg.text,
      replyTo: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      timestamp: new Date(msg.date * 1000),
      raw: msg,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[Telegram] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private formatOutgoing(message: OutgoingMessage): string {
    if (message.format === 'markdown') {
      return toTelegramMarkdownV2(message.text)
    }
    return message.text
  }

  private async apiCall<T = unknown>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${TELEGRAM_API}/bot${this.token}/${method}`
    const opts: RequestInit = {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal,
    }
    if (body) {
      // Strip undefined values
      const cleaned = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined),
      )
      opts.body = JSON.stringify(cleaned)
    }

    const res = await fetch(url, opts)
    const json = (await res.json()) as { ok: boolean; result: T; description?: string }

    if (!json.ok) {
      throw new Error(`Telegram API ${method}: ${json.description ?? res.statusText}`)
    }
    return json.result
  }
}

// ── Utilities ────────────────────────────────────────────────────

/** Escape special characters for MarkdownV2 */
function toTelegramMarkdownV2(text: string): string {
  // Telegram MarkdownV2 requires escaping these chars outside of entities
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }
    // Try to split at last newline within limit
    let splitIdx = remaining.lastIndexOf('\n', maxLen)
    if (splitIdx < maxLen * 0.3) {
      // No good newline break — split at space
      splitIdx = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitIdx < maxLen * 0.3) {
      // Hard split
      splitIdx = maxLen
    }
    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Telegram-specific types ──────────────────────────────────────

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface TelegramMessage {
  message_id: number
  from?: { id: number; username?: string; first_name?: string }
  chat: { id: number; type: string }
  date: number
  text?: string
  reply_to_message?: { message_id: number }
}
