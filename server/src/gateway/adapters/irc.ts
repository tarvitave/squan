/**
 * IRC Adapter
 *
 * Raw IRC protocol implementation using Node.js net/tls modules.
 * Parses PRIVMSG for incoming messages, handles PING/PONG keepalive,
 * JOINs configured channels on connect, and supports SASL PLAIN auth.
 */

import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from '../types'
import * as net from 'node:net'
import * as tls from 'node:tls'

const MAX_IRC_LINE = 510 // RFC 2812: 512 including CRLF
const MAX_MESSAGE_LENGTH = 400 // Safe PRIVMSG content length

export class IRCAdapter implements PlatformAdapter {
  readonly platform = 'irc' as const
  status: AdapterStatus = 'disconnected'

  private server = ''
  private port = 6667
  private nickname = ''
  private password = ''
  private channels: string[] = []
  private useTls = false
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // Connection state
  private socket: net.Socket | null = null
  private buffer = ''
  private registered = false
  private reconnecting = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPong = Date.now()
  private messageCounter = 0

  // SASL state
  private useSasl = false
  private saslUsername = ''
  private saslPassword = ''

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.server = config.credentials.server ?? ''
    this.port = parseInt(config.credentials.port ?? '6667', 10)
    this.nickname = config.credentials.nickname ?? 'SquanBot'
    this.password = config.credentials.password ?? ''
    this.useTls = config.credentials.use_tls === 'true'

    // Parse channels: comma/space separated, ensure # prefix
    const rawChannels = config.credentials.channels ?? ''
    this.channels = rawChannels
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => (c.startsWith('#') ? c : `#${c}`))

    // SASL config
    this.saslUsername = config.credentials.sasl_username ?? this.nickname
    this.saslPassword = config.credentials.sasl_password ?? this.password
    this.useSasl = !!(this.saslPassword && config.credentials.use_sasl !== 'false')

    if (!this.server) throw new Error('IRC adapter requires server credential')
    if (!this.nickname) throw new Error('IRC adapter requires nickname credential')

    this.status = 'connecting'

    return new Promise((resolve, reject) => {
      const onConnect = () => {
        console.log(`[IRC] TCP connection established to ${this.server}:${this.port}${this.useTls ? ' (TLS)' : ''}`)

        // Request capabilities for SASL if needed
        if (this.useSasl) {
          this.sendRaw('CAP REQ :sasl')
        }

        // Send PASS if configured (non-SASL)
        if (this.password && !this.useSasl) {
          this.sendRaw(`PASS ${this.password}`)
        }

        // Register with NICK and USER
        this.sendRaw(`NICK ${this.nickname}`)
        this.sendRaw(`USER ${this.nickname} 0 * :Squan Bot`)
      }

      if (this.useTls) {
        this.socket = tls.connect(
          { host: this.server, port: this.port, rejectUnauthorized: false },
          onConnect,
        )
      } else {
        this.socket = net.createConnection({ host: this.server, port: this.port }, onConnect)
      }

      this.socket.setEncoding('utf-8')
      this.socket.setKeepAlive(true, 30000)

      let resolved = false

      this.socket.on('data', (data: string) => {
        this.buffer += data
        this.processBuffer()

        // Resolve once we're registered
        if (this.registered && !resolved) {
          resolved = true
          this.status = 'connected'
          this.startPingCheck()
          resolve()
        }
      })

      this.socket.on('close', (hadError) => {
        console.log(`[IRC] Connection closed${hadError ? ' with error' : ''}`)
        this.stopPingCheck()
        this.registered = false

        if (!resolved) {
          resolved = true
          this.status = 'error'
          reject(new Error('IRC connection closed before registration'))
          return
        }

        if (this.status !== 'disconnected' && !this.reconnecting) {
          this.scheduleReconnect()
        }
      })

      this.socket.on('error', (err) => {
        console.error(`[IRC] Socket error: ${err.message}`)
        if (!resolved) {
          resolved = true
          this.status = 'error'
          reject(new Error(`IRC connection error: ${err.message}`))
        }
      })

      // Timeout for initial connection
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          this.status = 'error'
          this.socket?.destroy()
          reject(new Error('IRC connection timed out'))
        }
      }, 30000)
    })
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopPingCheck()
    if (this.socket) {
      this.sendRaw('QUIT :Goodbye')
      this.socket.destroy()
      this.socket = null
    }
    this.registered = false
    this.status = 'disconnected'
    console.log('[IRC] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    const text = message.text
    const lines = text.split('\n')
    const messageId = `irc_${++this.messageCounter}`

    for (const line of lines) {
      if (!line.trim()) continue

      const chunks = splitText(line, MAX_MESSAGE_LENGTH)
      for (const chunk of chunks) {
        // Apply formatting
        const formatted = this.formatOutgoing(chunk, message.format)
        this.sendRaw(`PRIVMSG ${channelId} :${formatted}`)

        // Rate limiting: small delay between messages
        await sleep(100)
      }
    }

    return messageId
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'IRC',
      description: 'IRC adapter using raw protocol via Node.js net/tls',
      requiredCredentials: ['server', 'port', 'nickname', 'channels'],
      optionalSettings: ['password', 'use_tls', 'use_sasl', 'sasl_username', 'sasl_password',
        'allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── IRC Line Processing ──────────────────────────────────────

  private processBuffer(): void {
    const lines = this.buffer.split('\r\n')
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line) continue
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    const parsed = this.parseLine(line)
    if (!parsed) return

    switch (parsed.command) {
      case 'PING':
        this.sendRaw(`PONG :${parsed.params[0] ?? ''}`)
        break

      case 'PONG':
        this.lastPong = Date.now()
        break

      case '001': // RPL_WELCOME — registration complete
        this.registered = true
        this.reconnecting = false
        console.log(`[IRC] Registered as ${this.nickname}`)

        // Join channels
        for (const channel of this.channels) {
          this.sendRaw(`JOIN ${channel}`)
          console.log(`[IRC] Joining ${channel}`)
        }
        break

      case '433': // ERR_NICKNAMEINUSE
        this.nickname = `${this.nickname}_`
        this.sendRaw(`NICK ${this.nickname}`)
        console.log(`[IRC] Nick in use, trying ${this.nickname}`)
        break

      case '376': // RPL_ENDOFMOTD
      case '422': // ERR_NOMOTD
        // Good time to join if we haven't already (some servers need this)
        if (this.registered) {
          for (const channel of this.channels) {
            this.sendRaw(`JOIN ${channel}`)
          }
        }
        break

      case 'CAP': {
        const subcommand = parsed.params[1]
        if (subcommand === 'ACK' && this.useSasl) {
          // Server acknowledged SASL cap
          this.sendRaw('AUTHENTICATE PLAIN')
        }
        break
      }

      case 'AUTHENTICATE': {
        if (parsed.params[0] === '+' && this.useSasl) {
          // Send SASL PLAIN credentials: base64(\0username\0password)
          const credentials = Buffer.from(
            `\0${this.saslUsername}\0${this.saslPassword}`,
          ).toString('base64')
          this.sendRaw(`AUTHENTICATE ${credentials}`)
        }
        break
      }

      case '903': // RPL_SASLSUCCESS
        console.log('[IRC] SASL authentication successful')
        this.sendRaw('CAP END')
        break

      case '904': // ERR_SASLFAIL
      case '905': // ERR_SASLTOOLONG
        console.error('[IRC] SASL authentication failed')
        this.sendRaw('CAP END')
        break

      case 'PRIVMSG':
        this.handlePrivmsg(parsed).catch((err) =>
          console.error(`[IRC] Message handler error: ${(err as Error).message}`),
        )
        break

      case 'NOTICE':
        // Log server notices
        if (parsed.prefix && !parsed.prefix.includes('!')) {
          console.log(`[IRC] Notice: ${parsed.params.join(' ')}`)
        }
        break

      case 'KICK': {
        const kickedChannel = parsed.params[0]
        const kickedNick = parsed.params[1]
        if (kickedNick === this.nickname) {
          console.log(`[IRC] Kicked from ${kickedChannel}, rejoining...`)
          setTimeout(() => this.sendRaw(`JOIN ${kickedChannel}`), 5000)
        }
        break
      }

      case 'INVITE': {
        const inviteChannel = parsed.params[1]
        if (inviteChannel) {
          console.log(`[IRC] Invited to ${inviteChannel}, joining...`)
          this.sendRaw(`JOIN ${inviteChannel}`)
          if (!this.channels.includes(inviteChannel)) {
            this.channels.push(inviteChannel)
          }
        }
        break
      }

      case 'ERROR':
        console.error(`[IRC] Server error: ${parsed.params.join(' ')}`)
        break
    }
  }

  private async handlePrivmsg(parsed: IRCParsedLine): Promise<void> {
    const target = parsed.params[0] // Channel or our nick (for DMs)
    const text = parsed.params[1] ?? ''

    if (!text) return

    // Parse sender: nick!user@host
    const nick = parsed.prefix?.split('!')[0] ?? ''

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(nick)) return

    // Determine channel: if target is our nick, it's a DM
    const isDM = target.toLowerCase() === this.nickname.toLowerCase()
    const channelId = isDM ? nick : target

    // For channel messages, check if the bot was addressed
    let messageText = text
    if (!isDM) {
      // Check for nick highlight: "BotNick: message" or "BotNick, message"
      const nickPrefix = new RegExp(`^${escapeRegex(this.nickname)}[,:;>]?\\s*`, 'i')
      if (nickPrefix.test(messageText)) {
        messageText = messageText.replace(nickPrefix, '').trim()
      } else if (this.config?.settings.commandPrefix) {
        // Check for command prefix
        if (messageText.startsWith(this.config.settings.commandPrefix)) {
          messageText = messageText.slice(this.config.settings.commandPrefix.length).trim()
        } else {
          // Not addressed to us, ignore
          return
        }
      } else {
        // No command prefix configured and not addressed — ignore channel chatter
        return
      }
    }

    const incoming: IncomingMessage = {
      platform: 'irc',
      platformUserId: nick,
      platformUserName: nick,
      channelId,
      messageId: `irc_${Date.now()}_${++this.messageCounter}`,
      text: messageText,
      timestamp: new Date(),
      raw: parsed,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[IRC] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── IRC Line Parser ──────────────────────────────────────────

  private parseLine(line: string): IRCParsedLine | null {
    let remaining = line
    let prefix: string | undefined
    let tags: string | undefined

    // Parse IRCv3 tags
    if (remaining.startsWith('@')) {
      const spaceIdx = remaining.indexOf(' ')
      if (spaceIdx === -1) return null
      tags = remaining.slice(1, spaceIdx)
      remaining = remaining.slice(spaceIdx + 1).trimStart()
    }

    // Parse prefix
    if (remaining.startsWith(':')) {
      const spaceIdx = remaining.indexOf(' ')
      if (spaceIdx === -1) return null
      prefix = remaining.slice(1, spaceIdx)
      remaining = remaining.slice(spaceIdx + 1).trimStart()
    }

    // Parse command
    const spaceIdx = remaining.indexOf(' ')
    let command: string
    if (spaceIdx === -1) {
      command = remaining.toUpperCase()
      remaining = ''
    } else {
      command = remaining.slice(0, spaceIdx).toUpperCase()
      remaining = remaining.slice(spaceIdx + 1)
    }

    // Parse params
    const params: string[] = []
    while (remaining.length > 0) {
      if (remaining.startsWith(':')) {
        // Trailing parameter — rest of the line
        params.push(remaining.slice(1))
        break
      }
      const nextSpace = remaining.indexOf(' ')
      if (nextSpace === -1) {
        params.push(remaining)
        break
      }
      params.push(remaining.slice(0, nextSpace))
      remaining = remaining.slice(nextSpace + 1).trimStart()
    }

    return { prefix, tags, command, params }
  }

  // ── Ping / Keepalive ─────────────────────────────────────────

  private startPingCheck(): void {
    this.stopPingCheck()
    this.lastPong = Date.now()

    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPong > 300_000) {
        // No pong in 5 minutes — connection is dead
        console.warn('[IRC] Ping timeout — reconnecting')
        this.socket?.destroy()
        return
      }

      // Send periodic PING
      this.sendRaw(`PING :squan_${Date.now()}`)
    }, 60_000)
  }

  private stopPingCheck(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  // ── Reconnection ─────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.reconnecting = true
    this.status = 'connecting'
    const delay = 5000 + Math.random() * 10000
    console.log(`[IRC] Reconnecting in ${Math.round(delay)}ms...`)
    this.reconnectTimer = setTimeout(() => {
      if (this.reconnecting && this.config) {
        this.connect(this.config).catch((err) => {
          console.error(`[IRC] Reconnect failed: ${(err as Error).message}`)
          this.scheduleReconnect()
        })
      }
    }, delay)
  }

  // ── Helpers ──────────────────────────────────────────────────

  private sendRaw(line: string): void {
    if (this.socket && !this.socket.destroyed) {
      // Truncate to max IRC line length
      const truncated = line.length > MAX_IRC_LINE ? line.slice(0, MAX_IRC_LINE) : line
      this.socket.write(`${truncated}\r\n`)
    }
  }

  private formatOutgoing(text: string, format?: 'plain' | 'markdown' | 'html'): string {
    if (format === 'markdown') {
      // Convert basic markdown to IRC formatting
      return text
        .replace(/\*\*(.+?)\*\*/g, '\x02$1\x02')   // bold
        .replace(/\*(.+?)\*/g, '\x1D$1\x1D')         // italic
        .replace(/__(.+?)__/g, '\x1F$1\x1F')          // underline
        .replace(/`(.+?)`/g, '$1')                     // code (no IRC equivalent, just strip)
        .replace(/~~(.+?)~~/g, '$1')                   // strikethrough (no IRC equivalent)
    }
    return text
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
    let splitIdx = remaining.lastIndexOf(' ', maxLen)
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen
    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).trimStart()
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── IRC-specific types ───────────────────────────────────────────

interface IRCParsedLine {
  prefix?: string
  tags?: string
  command: string
  params: string[]
}
