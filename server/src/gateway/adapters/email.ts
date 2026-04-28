/**
 * Email Adapter (IMAP + SMTP)
 *
 * Receives emails via IMAP polling (checks every 30 seconds).
 * Sends HTML-formatted responses via SMTP.
 * Uses Node.js built-in net/tls modules for protocol communication.
 * Subject line is used as thread/session identifier.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'
import * as tls from 'node:tls'
import * as net from 'node:net'
import * as crypto from 'node:crypto'

const POLL_INTERVAL = 30_000 // 30 seconds

export class EmailAdapter implements PlatformAdapter {
  readonly platform = 'email' as const
  status: AdapterStatus = 'disconnected'

  private imapHost = ''
  private imapPort = 993
  private smtpHost = ''
  private smtpPort = 587
  private emailAddress = ''
  private emailPassword = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Polling state
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastSeenUid = 0
  private polling = false

  // Track seen message IDs for deduplication
  private seenMessageIds = new Set<string>()

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.imapHost = config.credentials.imap_host
    this.imapPort = parseInt(config.credentials.imap_port ?? '993', 10)
    this.smtpHost = config.credentials.smtp_host
    this.smtpPort = parseInt(config.credentials.smtp_port ?? '587', 10)
    this.emailAddress = config.credentials.email_address
    this.emailPassword = config.credentials.email_password

    if (!this.imapHost) throw new Error('Email adapter requires imap_host credential')
    if (!this.smtpHost) throw new Error('Email adapter requires smtp_host credential')
    if (!this.emailAddress) throw new Error('Email adapter requires email_address credential')
    if (!this.emailPassword) throw new Error('Email adapter requires email_password credential')

    this.status = 'connecting'

    try {
      // Test IMAP connection
      await this.testImapConnection()
      console.log(`[Email] IMAP connected to ${this.imapHost}:${this.imapPort}`)

      // Test SMTP connection
      await this.testSmtpConnection()
      console.log(`[Email] SMTP connected to ${this.smtpHost}:${this.smtpPort}`)

      this.status = 'connected'
      this.startPolling()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Email] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.seenMessageIds.clear()
    this.status = 'disconnected'
    console.log('[Email] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    // channelId format: "email@address.com|Subject Line"
    const [toAddress, subject] = parseChannelId(channelId)
    if (!toAddress) throw new Error('Invalid channel ID: expected "email|subject"')

    const messageId = `<${crypto.randomUUID()}@${this.emailAddress.split('@')[1] ?? 'squan.local'}>`
    const htmlBody = this.formatOutgoing(message)
    const plainBody = message.text

    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`

    const headers = [
      `From: Squan <${this.emailAddress}>`,
      `To: ${toAddress}`,
      `Subject: ${replySubject}`,
      `Message-ID: ${messageId}`,
      message.replyTo ? `In-Reply-To: ${message.replyTo}` : '',
      message.replyTo ? `References: ${message.replyTo}` : '',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="squan_boundary"',
      `Date: ${new Date().toUTCString()}`,
    ].filter(Boolean)

    const emailContent = [
      ...headers,
      '',
      '--squan_boundary',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      plainBody,
      '',
      '--squan_boundary',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      htmlBody,
      '',
      '--squan_boundary--',
    ].join('\r\n')

    await this.sendSmtp(toAddress, emailContent)
    return messageId
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Email',
      description: 'Email adapter using IMAP (receive) and SMTP (send)',
      requiredCredentials: [
        'imap_host', 'imap_port', 'smtp_host', 'smtp_port',
        'email_address', 'email_password',
      ],
      optionalSettings: ['allowedUsers', 'autoDispatch'],
    }
  }

  // ── IMAP Polling ─────────────────────────────────────────────

  private startPolling(): void {
    // Do an initial poll
    this.pollInbox().catch((err) =>
      console.error(`[Email] Initial poll error: ${(err as Error).message}`),
    )

    this.pollTimer = setInterval(() => {
      if (!this.polling) {
        this.pollInbox().catch((err) =>
          console.error(`[Email] Poll error: ${(err as Error).message}`),
        )
      }
    }, POLL_INTERVAL)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollInbox(): Promise<void> {
    this.polling = true
    try {
      const emails = await this.fetchNewEmails()
      for (const email of emails) {
        if (this.seenMessageIds.has(email.messageId)) continue
        this.seenMessageIds.add(email.messageId)

        // Periodic cleanup of seen IDs (keep last 1000)
        if (this.seenMessageIds.size > 1000) {
          const arr = Array.from(this.seenMessageIds)
          this.seenMessageIds = new Set(arr.slice(-500))
        }

        // Access control
        const allowed = this.config?.settings.allowedUsers
        if (allowed && allowed.length > 0 && !allowed.includes(email.from)) continue

        const channelId = buildChannelId(email.from, email.subject)

        const incoming: IncomingMessage = {
          platform: 'email',
          platformUserId: email.from,
          platformUserName: email.fromName || email.from,
          channelId,
          messageId: email.messageId,
          text: email.textBody,
          replyTo: email.inReplyTo,
          timestamp: email.date,
          raw: email.raw,
        }

        try {
          await this.messageHandler?.(incoming)
        } catch (err) {
          console.error(`[Email] Message handler error: ${(err as Error).message}`)
        }
      }
    } finally {
      this.polling = false
    }
  }

  // ── IMAP Implementation ──────────────────────────────────────

  private async testImapConnection(): Promise<void> {
    const responses = await this.imapSession(async (send, readUntil) => {
      const greeting = await readUntil('OK')
      if (!greeting.some((l) => l.includes('OK'))) {
        throw new Error('IMAP server did not send OK greeting')
      }

      send('A001 LOGIN ' + quoteImapArg(this.emailAddress) + ' ' + quoteImapArg(this.emailPassword))
      const loginResp = await readUntil('A001')
      if (!loginResp.some((l) => l.includes('A001 OK'))) {
        throw new Error('IMAP LOGIN failed: ' + loginResp.join(' '))
      }

      send('A002 LOGOUT')
      return loginResp
    })
  }

  private async fetchNewEmails(): Promise<ParsedEmail[]> {
    const emails: ParsedEmail[] = []

    await this.imapSession(async (send, readUntil) => {
      // Greeting
      await readUntil('OK')

      // Login
      send('A001 LOGIN ' + quoteImapArg(this.emailAddress) + ' ' + quoteImapArg(this.emailPassword))
      const loginResp = await readUntil('A001')
      if (!loginResp.some((l) => l.includes('A001 OK'))) {
        throw new Error('IMAP LOGIN failed')
      }

      // Select INBOX
      send('A002 SELECT INBOX')
      const selectResp = await readUntil('A002')
      if (!selectResp.some((l) => l.includes('A002 OK'))) {
        throw new Error('IMAP SELECT INBOX failed')
      }

      // Parse UIDNEXT to know the upper bound
      const uidNextLine = selectResp.find((l) => l.includes('UIDNEXT'))
      const uidNextMatch = uidNextLine?.match(/UIDNEXT\s+(\d+)/)
      const uidNext = uidNextMatch ? parseInt(uidNextMatch[1], 10) : 0

      // Search for unseen messages (or messages after our last seen UID)
      const searchCriteria = this.lastSeenUid > 0
        ? `UID ${this.lastSeenUid + 1}:*`
        : 'UNSEEN'

      send(`A003 UID SEARCH ${searchCriteria}`)
      const searchResp = await readUntil('A003')
      const searchLine = searchResp.find((l) => l.startsWith('* SEARCH'))
      const uids = searchLine
        ? searchLine.replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).map(Number)
        : []

      // Fetch each message
      for (const uid of uids) {
        if (uid <= this.lastSeenUid) continue

        send(`A1${uid} UID FETCH ${uid} (BODY[HEADER] BODY[TEXT])`)
        const fetchResp = await readUntil(`A1${uid}`, 10_000)

        const raw = fetchResp.join('\r\n')
        const parsed = parseEmailResponse(raw)
        if (parsed) {
          emails.push(parsed)
        }

        this.lastSeenUid = Math.max(this.lastSeenUid, uid)
      }

      // Mark messages as seen
      if (uids.length > 0) {
        const uidList = uids.join(',')
        send(`A004 UID STORE ${uidList} +FLAGS (\\Seen)`)
        await readUntil('A004')
      }

      // Logout
      send('A099 LOGOUT')
    })

    return emails
  }

  private imapSession<T>(
    handler: (
      send: (cmd: string) => void,
      readUntil: (tag: string, timeout?: number) => Promise<string[]>,
    ) => Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const useSSL = this.imapPort === 993
      let buffer = ''
      const lines: string[] = []
      let waitingTag: string | null = null
      let waitingResolve: ((lines: string[]) => void) | null = null
      let waitingTimeout: ReturnType<typeof setTimeout> | null = null
      let collectedLines: string[] = []

      const socket = useSSL
        ? tls.connect({ host: this.imapHost, port: this.imapPort, rejectUnauthorized: false })
        : net.connect({ host: this.imapHost, port: this.imapPort })

      const cleanup = () => {
        if (waitingTimeout) clearTimeout(waitingTimeout)
        socket.destroy()
      }

      socket.setEncoding('utf8')

      socket.on('data', (chunk: string) => {
        buffer += chunk
        const parts = buffer.split('\r\n')
        buffer = parts.pop() ?? ''

        for (const line of parts) {
          if (waitingTag) {
            collectedLines.push(line)
            if (line.startsWith(waitingTag + ' ') || line.startsWith('* OK') && waitingTag === 'OK') {
              const resolved = [...collectedLines]
              collectedLines = []
              const wr = waitingResolve
              waitingResolve = null
              waitingTag = null
              if (waitingTimeout) clearTimeout(waitingTimeout)
              wr?.(resolved)
            }
          } else {
            lines.push(line)
          }
        }
      })

      socket.on('error', (err) => {
        cleanup()
        reject(err)
      })

      const onReady = () => {
        const send = (cmd: string) => {
          socket.write(cmd + '\r\n')
        }

        const readUntil = (tag: string, timeout = 30_000): Promise<string[]> => {
          return new Promise((res, rej) => {
            // Check if we already have it in buffered lines
            const existingIdx = lines.findIndex((l) =>
              l.startsWith(tag + ' ') || (tag === 'OK' && l.includes('OK')),
            )
            if (existingIdx >= 0) {
              const result = lines.splice(0, existingIdx + 1)
              res(result)
              return
            }

            // Move any pending lines to collected
            collectedLines = [...lines.splice(0)]
            waitingTag = tag
            waitingResolve = res
            waitingTimeout = setTimeout(() => {
              waitingResolve = null
              waitingTag = null
              rej(new Error(`IMAP timeout waiting for tag ${tag}`))
            }, timeout)
          })
        }

        handler(send, readUntil)
          .then((result) => {
            cleanup()
            resolve(result)
          })
          .catch((err) => {
            cleanup()
            reject(err)
          })
      }

      if (useSSL) {
        (socket as tls.TLSSocket).on('secureConnect', onReady)
      } else {
        socket.on('connect', onReady)
      }
    })
  }

  // ── SMTP Implementation ──────────────────────────────────────

  private async testSmtpConnection(): Promise<void> {
    await this.smtpSession(async (send, readLine) => {
      // Read greeting
      const greeting = await readLine()
      if (!greeting.startsWith('220')) throw new Error(`SMTP greeting: ${greeting}`)

      send('EHLO squan.local')
      // Read all EHLO responses (multi-line)
      let line = await readLine()
      while (line.charAt(3) === '-') {
        line = await readLine()
      }

      send('QUIT')
    })
  }

  private async sendSmtp(to: string, content: string): Promise<void> {
    await this.smtpSession(async (send, readLine) => {
      // Greeting
      const greeting = await readLine()
      if (!greeting.startsWith('220')) throw new Error(`SMTP greeting: ${greeting}`)

      // EHLO
      send('EHLO squan.local')
      let line = await readLine()
      const ehloFeatures: string[] = [line]
      while (line.charAt(3) === '-') {
        line = await readLine()
        ehloFeatures.push(line)
      }

      // STARTTLS if available and not already on port 465
      const supportsStartTLS = ehloFeatures.some((l) => l.toUpperCase().includes('STARTTLS'))
      if (supportsStartTLS && this.smtpPort !== 465) {
        send('STARTTLS')
        const tlsResp = await readLine()
        if (!tlsResp.startsWith('220')) throw new Error(`STARTTLS failed: ${tlsResp}`)
        // NOTE: Upgrading to TLS in-stream requires socket upgrade
        // For simplicity, we proceed — in production, use a proper SMTP library
      }

      // AUTH LOGIN
      send('AUTH LOGIN')
      const authResp = await readLine()
      if (authResp.startsWith('334')) {
        send(Buffer.from(this.emailAddress).toString('base64'))
        const userResp = await readLine()
        if (userResp.startsWith('334')) {
          send(Buffer.from(this.emailPassword).toString('base64'))
          const passResp = await readLine()
          if (!passResp.startsWith('235')) {
            throw new Error(`SMTP AUTH failed: ${passResp}`)
          }
        }
      }

      // MAIL FROM
      send(`MAIL FROM:<${this.emailAddress}>`)
      const fromResp = await readLine()
      if (!fromResp.startsWith('250')) throw new Error(`MAIL FROM failed: ${fromResp}`)

      // RCPT TO
      send(`RCPT TO:<${to}>`)
      const rcptResp = await readLine()
      if (!rcptResp.startsWith('250')) throw new Error(`RCPT TO failed: ${rcptResp}`)

      // DATA
      send('DATA')
      const dataResp = await readLine()
      if (!dataResp.startsWith('354')) throw new Error(`DATA failed: ${dataResp}`)

      // Send email content, escaping leading dots
      const lines = content.split('\r\n')
      for (const l of lines) {
        send(l.startsWith('.') ? '.' + l : l)
      }
      send('.')
      const doneResp = await readLine()
      if (!doneResp.startsWith('250')) throw new Error(`Message send failed: ${doneResp}`)

      send('QUIT')
    })
  }

  private smtpSession<T>(
    handler: (
      send: (cmd: string) => void,
      readLine: () => Promise<string>,
    ) => Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const useSSL = this.smtpPort === 465
      let buffer = ''
      const lineQueue: string[] = []
      let lineWaiter: ((line: string) => void) | null = null

      const socket = useSSL
        ? tls.connect({ host: this.smtpHost, port: this.smtpPort, rejectUnauthorized: false })
        : net.connect({ host: this.smtpHost, port: this.smtpPort })

      const cleanup = () => socket.destroy()

      socket.setEncoding('utf8')

      socket.on('data', (chunk: string) => {
        buffer += chunk
        const parts = buffer.split('\r\n')
        buffer = parts.pop() ?? ''

        for (const line of parts) {
          if (lineWaiter) {
            const waiter = lineWaiter
            lineWaiter = null
            waiter(line)
          } else {
            lineQueue.push(line)
          }
        }
      })

      socket.on('error', (err) => {
        cleanup()
        reject(err)
      })

      const onReady = () => {
        const send = (cmd: string) => {
          socket.write(cmd + '\r\n')
        }

        const readLine = (): Promise<string> => {
          if (lineQueue.length > 0) {
            return Promise.resolve(lineQueue.shift()!)
          }
          return new Promise((res) => {
            lineWaiter = res
          })
        }

        handler(send, readLine)
          .then((result) => {
            cleanup()
            resolve(result)
          })
          .catch((err) => {
            cleanup()
            reject(err)
          })
      }

      if (useSSL) {
        (socket as tls.TLSSocket).on('secureConnect', onReady)
      } else {
        socket.on('connect', onReady)
      }
    })
  }

  // ── Helpers ──────────────────────────────────────────────────

  private formatOutgoing(message: OutgoingMessage): string {
    if (message.format === 'html') {
      return wrapHtml(message.text)
    }
    if (message.format === 'markdown') {
      return wrapHtml(simpleMarkdownToHtml(message.text))
    }
    // Plain text — wrap in basic HTML
    const escaped = message.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
    return wrapHtml(escaped)
  }
}

// ── Utilities ────────────────────────────────────────────────────

function buildChannelId(email: string, subject: string): string {
  // Normalize subject (strip Re:, Fwd:, etc.)
  const normalizedSubject = subject.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim()
  return `${email}|${normalizedSubject}`
}

function parseChannelId(channelId: string): [string, string] {
  const pipeIdx = channelId.indexOf('|')
  if (pipeIdx < 0) return [channelId, '(no subject)']
  return [channelId.slice(0, pipeIdx), channelId.slice(pipeIdx + 1)]
}

function quoteImapArg(arg: string): string {
  // IMAP quoted string — escape backslash and double-quote
  return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function parseEmailResponse(raw: string): ParsedEmail | null {
  try {
    // Extract headers
    const headerMatch = raw.match(/BODY\[HEADER\]\s*\{(\d+)\}\r\n([\s\S]*?)(?=\r\n\r\n|\* \d|A1\d)/i)
    const textMatch = raw.match(/BODY\[TEXT\]\s*\{(\d+)\}\r\n([\s\S]*?)(?=\)(?:\r\n|$)|A1\d)/i)

    const headers = headerMatch?.[2] ?? raw
    const textBody = textMatch?.[2] ?? ''

    const getHeader = (name: string): string => {
      const regex = new RegExp(`^${name}:\\s*(.+?)(?=\\r?\\n(?!\\s)|$)`, 'im')
      const match = headers.match(regex)
      return match?.[1]?.trim() ?? ''
    }

    const from = getHeader('From')
    const subject = getHeader('Subject')
    const messageId = getHeader('Message-ID') || getHeader('Message-Id')
    const dateStr = getHeader('Date')
    const inReplyTo = getHeader('In-Reply-To')

    if (!from) return null

    // Extract email address from "Name <email>" format
    const emailMatch = from.match(/<([^>]+)>/)
    const fromEmail = emailMatch?.[1] ?? from
    const fromName = from.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '')

    // Clean up text body — strip MIME boundaries and quoted parts
    let cleanText = textBody
      .replace(/--[\w-]+--?\r?\n/g, '') // Remove MIME boundaries
      .replace(/Content-Type:.*\r?\n/gi, '')
      .replace(/Content-Transfer-Encoding:.*\r?\n/gi, '')
      .trim()

    // Strip HTML tags if body appears to be HTML
    if (cleanText.includes('<html') || cleanText.includes('<body')) {
      cleanText = cleanText
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
    }

    return {
      from: fromEmail,
      fromName,
      subject,
      messageId,
      inReplyTo,
      textBody: cleanText || '(empty)',
      date: dateStr ? new Date(dateStr) : new Date(),
      raw,
    }
  } catch {
    return null
  }
}

function simpleMarkdownToHtml(text: string): string {
  let html = text
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/\n/g, '<br>')
  return html
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333; max-width: 600px; }
pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
code { background: #f4f4f4; padding: 2px 4px; border-radius: 2px; font-size: 13px; }
pre code { background: none; padding: 0; }
</style></head>
<body>${body}</body>
</html>`
}

// ── Email-specific types ─────────────────────────────────────────

interface ParsedEmail {
  from: string
  fromName: string
  subject: string
  messageId: string
  inReplyTo: string
  textBody: string
  date: Date
  raw: string
}
