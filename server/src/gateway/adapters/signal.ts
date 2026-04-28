/**
 * Signal Adapter
 *
 * Uses the signal-cli-rest-api (https://github.com/bbernhard/signal-cli-rest-api)
 * to send and receive messages. Polls /v1/receive/{number} for incoming messages
 * and sends via POST /v2/send.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
  Attachment,
} from '../types'

const MAX_MESSAGE_LENGTH = 4096

export class SignalAdapter implements PlatformAdapter {
  readonly platform = 'signal' as const
  status: AdapterStatus = 'disconnected'

  private apiUrl = ''
  private phoneNumber = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private pollingAbort: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.apiUrl = (config.credentials.signal_api_url ?? '').replace(/\/$/, '')
    this.phoneNumber = config.credentials.phone_number ?? ''

    if (!this.apiUrl) throw new Error('Signal adapter requires signal_api_url credential')
    if (!this.phoneNumber) throw new Error('Signal adapter requires phone_number credential')

    this.status = 'connecting'

    try {
      // Verify the API is reachable and the number is registered
      const res = await fetch(`${this.apiUrl}/v1/about`)
      if (!res.ok) {
        throw new Error(`API not reachable: ${res.status} ${res.statusText}`)
      }
      const about = (await res.json()) as { versions?: string[] }
      console.log(`[Signal] Connected to signal-cli-rest-api (versions: ${about.versions?.join(', ') ?? 'unknown'})`)

      // Verify the number is registered
      const regRes = await fetch(`${this.apiUrl}/v1/accounts`)
      if (regRes.ok) {
        const accounts = (await regRes.json()) as string[]
        if (!accounts.includes(this.phoneNumber)) {
          console.warn(`[Signal] Phone number ${this.phoneNumber} may not be registered — attempting anyway`)
        }
      }

      this.status = 'connected'
      this.startPolling()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Signal] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.status = 'disconnected'
    console.log('[Signal] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = message.text
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastTimestamp = ''

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        message: chunk,
        number: this.phoneNumber,
        recipients: [channelId],
      }

      // Attach base64-encoded files if present
      if (message.attachments && message.attachments.length > 0) {
        body.base64_attachments = message.attachments
          .filter((a: Attachment) => a.data)
          .map((a: Attachment) => `data:${a.mimeType ?? 'application/octet-stream'};filename=${a.filename ?? 'file'};base64,${a.data!.toString('base64')}`)
      }

      const res = await fetch(`${this.apiUrl}/v2/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Signal send failed: ${res.status} ${errText}`)
      }

      const result = (await res.json()) as { timestamp?: string }
      lastTimestamp = result.timestamp ?? String(Date.now())
    }

    return lastTimestamp
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Signal',
      description: 'Signal Messenger adapter via signal-cli-rest-api',
      requiredCredentials: ['signal_api_url', 'phone_number'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Polling ──────────────────────────────────────────────────

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
        const encoded = encodeURIComponent(this.phoneNumber)
        const res = await fetch(`${this.apiUrl}/v1/receive/${encoded}`, {
          signal: this.pollingAbort.signal,
        })

        if (!res.ok) {
          console.error(`[Signal] Receive error: ${res.status} ${res.statusText}`)
          await sleep(5000)
          continue
        }

        const messages = (await res.json()) as SignalEnvelope[]

        for (const envelope of messages) {
          if (envelope.envelope?.dataMessage) {
            await this.handleMessage(envelope.envelope)
          }
        }

        // Small delay between polls to avoid hammering the API
        await sleep(1000)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error(`[Signal] Polling error: ${(err as Error).message}`)
        await sleep(5000)
      }
    }
  }

  private async handleMessage(envelope: SignalEnvelopeInner): Promise<void> {
    const data = envelope.dataMessage
    if (!data?.message) return

    const sourceNumber = envelope.sourceNumber ?? envelope.source ?? ''
    const sourceName = envelope.sourceName ?? sourceNumber

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(sourceNumber)) return

    // Build attachments list
    const attachments: Attachment[] = (data.attachments ?? []).map((att: SignalAttachment) => ({
      type: att.contentType?.startsWith('image/') ? 'image' as const : 'file' as const,
      filename: att.filename ?? att.id,
      mimeType: att.contentType,
      url: att.id ? `${this.apiUrl}/v1/attachments/${att.id}` : undefined,
    }))

    // Use group ID as channel if it's a group message, otherwise sender number
    const channelId = data.groupInfo?.groupId ?? sourceNumber

    const incoming: IncomingMessage = {
      platform: 'signal',
      platformUserId: sourceNumber,
      platformUserName: sourceName,
      channelId,
      messageId: String(data.timestamp ?? Date.now()),
      text: data.message,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo: data.quote?.id ? String(data.quote.id) : undefined,
      timestamp: new Date(envelope.timestamp ?? Date.now()),
      raw: envelope,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[Signal] Message handler error: ${(err as Error).message}`)
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Signal-specific types ────────────────────────────────────────

interface SignalEnvelope {
  envelope: SignalEnvelopeInner
  account?: string
}

interface SignalEnvelopeInner {
  source?: string
  sourceNumber?: string
  sourceName?: string
  timestamp?: number
  dataMessage?: {
    timestamp?: number
    message?: string
    groupInfo?: { groupId: string; type?: string }
    attachments?: SignalAttachment[]
    quote?: { id: number; author?: string; text?: string }
  }
}

interface SignalAttachment {
  contentType?: string
  filename?: string
  id?: string
  size?: number
}
