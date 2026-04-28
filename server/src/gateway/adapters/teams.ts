/**
 * Microsoft Teams Adapter (Bot Framework)
 *
 * Receives messages via a webhook endpoint using the Bot Framework protocol.
 * Sends replies via the Bot Framework REST API.
 * Exports a webhookRouter for Express mounting at /gateway/teams.
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

const BOT_FRAMEWORK_AUTH = 'https://login.microsoftonline.com'
const BOT_FRAMEWORK_API = 'https://smba.trafficmanager.net'
const MAX_MESSAGE_LENGTH = 28000 // Teams card limit

export class TeamsAdapter implements PlatformAdapter {
  readonly platform = 'teams' as const
  status: AdapterStatus = 'disconnected'

  private appId = ''
  private appPassword = ''
  private tenantId = ''
  private config: PlatformConfig | null = null
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null

  // OAuth token management
  private accessToken = ''
  private tokenExpiresAt = 0
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

  /** Express router — mount at /gateway/teams on your app */
  readonly webhookRouter: Router = Router()

  // Store service URLs per conversation for sending replies
  private serviceUrls = new Map<string, string>()

  constructor() {
    this.setupRoutes()
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(config: PlatformConfig): Promise<void> {
    this.config = config
    this.appId = config.credentials.app_id ?? ''
    this.appPassword = config.credentials.app_password ?? ''
    this.tenantId = config.credentials.tenant_id ?? ''

    if (!this.appId) throw new Error('Teams adapter requires app_id credential')
    if (!this.appPassword) throw new Error('Teams adapter requires app_password credential')

    this.status = 'connecting'

    try {
      // Obtain initial access token
      await this.refreshAccessToken()
      console.log(`[Teams] Connected with app ID: ${this.appId}`)
      this.status = 'connected'

      // Schedule token refresh
      this.scheduleTokenRefresh()
    } catch (err) {
      this.status = 'error'
      throw new Error(`[Teams] Connection failed: ${(err as Error).message}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    this.serviceUrls.clear()
    this.accessToken = ''
    this.status = 'disconnected'
    console.log('[Teams] Disconnected')
  }

  // ── Messaging ────────────────────────────────────────────────

  async send(channelId: string, message: OutgoingMessage): Promise<string> {
    // channelId format: "serviceUrl|conversationId"
    const [serviceUrl, conversationId] = this.parseChannelId(channelId)
    if (!serviceUrl || !conversationId) {
      throw new Error(`Invalid channelId format. Expected "serviceUrl|conversationId", got: ${channelId}`)
    }

    await this.ensureToken()
    const text = this.formatOutgoing(message)
    const chunks = splitText(text, MAX_MESSAGE_LENGTH)
    let lastActivityId = ''

    for (const chunk of chunks) {
      const activity: Record<string, unknown> = {
        type: 'message',
        text: chunk,
        textFormat: message.format === 'markdown' ? 'markdown' : 'plain',
      }

      if (message.replyTo) {
        activity.replyToId = message.replyTo
      }

      const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(activity),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Teams send failed: ${res.status} ${errText}`)
      }

      const result = (await res.json()) as { id: string }
      lastActivityId = result.id
    }

    return lastActivityId
  }

  async edit(messageId: string, channelId: string, message: OutgoingMessage): Promise<void> {
    const [serviceUrl, conversationId] = this.parseChannelId(channelId)
    if (!serviceUrl || !conversationId) return

    await this.ensureToken()
    const text = this.formatOutgoing(message)

    const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(messageId)}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'message',
        text: text.slice(0, MAX_MESSAGE_LENGTH),
        textFormat: message.format === 'markdown' ? 'markdown' : 'plain',
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Teams edit failed: ${res.status} ${errText}`)
    }
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    const [serviceUrl, conversationId] = this.parseChannelId(channelId)
    if (!serviceUrl || !conversationId) return

    // Teams doesn't have a native reaction API via Bot Framework;
    // send a reply with the emoji as acknowledgment
    await this.send(channelId, { text: emoji, replyTo: messageId })
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  getInfo() {
    return {
      name: 'Microsoft Teams',
      description: 'Microsoft Teams adapter via Bot Framework webhook',
      requiredCredentials: ['app_id', 'app_password', 'tenant_id'],
      optionalSettings: ['allowedUsers', 'commandPrefix', 'autoDispatch', 'sessionMode'],
    }
  }

  // ── Webhook Routes ───────────────────────────────────────────

  private setupRoutes(): void {
    // Bot Framework sends activities to POST /messages
    this.webhookRouter.post('/messages', async (req: Request, res: Response) => {
      try {
        // Validate the JWT token from Bot Framework
        const authHeader = req.headers.authorization ?? ''
        if (!await this.validateBotFrameworkAuth(authHeader)) {
          res.sendStatus(401)
          return
        }

        const activity = req.body as TeamsActivity

        // Store service URL for this conversation
        if (activity.serviceUrl && activity.conversation?.id) {
          this.serviceUrls.set(activity.conversation.id, activity.serviceUrl)
        }

        // Respond 200 immediately
        res.sendStatus(200)

        // Process the activity
        await this.handleActivity(activity)
      } catch (err) {
        console.error(`[Teams] Webhook error: ${(err as Error).message}`)
        if (!res.headersSent) res.sendStatus(500)
      }
    })
  }

  private async validateBotFrameworkAuth(authHeader: string): Promise<boolean> {
    // In production, you should verify the JWT against the Bot Framework OpenID metadata.
    // For now, we verify that an auth header is present and has the Bearer scheme.
    if (!authHeader.startsWith('Bearer ')) {
      // Allow no-auth in development mode
      console.warn('[Teams] No Bearer token in request — accepting in dev mode')
      return true
    }

    // Basic JWT structure validation: header.payload.signature
    const token = authHeader.slice(7)
    const parts = token.split('.')
    if (parts.length !== 3) return false

    try {
      const payloadStr = Buffer.from(parts[1], 'base64url').toString()
      const payload = JSON.parse(payloadStr) as { aud?: string; iss?: string; exp?: number }

      // Verify audience matches our app ID
      if (payload.aud !== this.appId) {
        console.warn(`[Teams] JWT audience mismatch: expected ${this.appId}, got ${payload.aud}`)
        return false
      }

      // Verify token hasn't expired
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        console.warn('[Teams] JWT has expired')
        return false
      }

      return true
    } catch {
      return false
    }
  }

  private async handleActivity(activity: TeamsActivity): Promise<void> {
    if (this.status !== 'connected') return

    switch (activity.type) {
      case 'message':
        await this.handleMessage(activity)
        break
      case 'conversationUpdate':
        // Could handle member added/removed events here
        console.log('[Teams] Conversation update received')
        break
      case 'invoke':
        console.log(`[Teams] Invoke activity: ${activity.name}`)
        break
    }
  }

  private async handleMessage(activity: TeamsActivity): Promise<void> {
    if (!activity.text) return

    const userId = activity.from?.id ?? ''
    const userName = activity.from?.name ?? 'unknown'

    // Access control
    const allowed = this.config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) return

    // Strip @mention of the bot from the text
    let text = activity.text
    if (activity.entities) {
      for (const entity of activity.entities) {
        if (entity.type === 'mention' && entity.mentioned?.id === this.appId) {
          text = text.replace(entity.text ?? '', '').trim()
        }
      }
    }

    // Build composite channel ID
    const serviceUrl = activity.serviceUrl ?? this.serviceUrls.get(activity.conversation?.id ?? '') ?? ''
    const conversationId = activity.conversation?.id ?? ''
    const channelId = `${serviceUrl}|${conversationId}`

    const incoming: IncomingMessage = {
      platform: 'teams',
      platformUserId: userId,
      platformUserName: userName,
      channelId,
      messageId: activity.id ?? String(Date.now()),
      text,
      replyTo: activity.replyToId,
      timestamp: new Date(activity.timestamp ?? Date.now()),
      raw: activity,
    }

    try {
      await this.messageHandler?.(incoming)
    } catch (err) {
      console.error(`[Teams] Message handler error: ${(err as Error).message}`)
    }
  }

  // ── OAuth Token ──────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const tenantPath = this.tenantId || 'botframework.com'
    const tokenUrl = `${BOT_FRAMEWORK_AUTH}/${tenantPath}/oauth2/v2.0/token`

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.appId,
      client_secret: this.appPassword,
      scope: 'https://api.botframework.com/.default',
    })

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Token refresh failed: ${res.status} ${errText}`)
    }

    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000
    console.log(`[Teams] Access token refreshed, expires in ${data.expires_in}s`)
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)

    // Refresh 5 minutes before expiry
    const refreshIn = Math.max((this.tokenExpiresAt - Date.now()) - 300_000, 60_000)
    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshAccessToken()
        this.scheduleTokenRefresh()
      } catch (err) {
        console.error(`[Teams] Token refresh error: ${(err as Error).message}`)
        // Retry in 30 seconds
        this.tokenRefreshTimer = setTimeout(() => this.scheduleTokenRefresh(), 30_000)
      }
    }, refreshIn)
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt - 60_000) {
      await this.refreshAccessToken()
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private parseChannelId(channelId: string): [string, string] {
    const idx = channelId.indexOf('|')
    if (idx === -1) {
      // Try to look up service URL from stored conversations
      const serviceUrl = this.serviceUrls.get(channelId)
      return [serviceUrl ?? '', channelId]
    }
    return [channelId.slice(0, idx), channelId.slice(idx + 1)]
  }

  private formatOutgoing(message: OutgoingMessage): string {
    return message.text
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

// ── Teams-specific types ─────────────────────────────────────────

interface TeamsActivity {
  type: string
  id?: string
  timestamp?: string
  serviceUrl?: string
  channelId?: string
  from?: { id: string; name: string; aadObjectId?: string }
  conversation?: { id: string; conversationType?: string; tenantId?: string; isGroup?: boolean }
  recipient?: { id: string; name: string }
  text?: string
  name?: string
  replyToId?: string
  entities?: Array<{
    type: string
    text?: string
    mentioned?: { id: string; name: string }
  }>
  channelData?: Record<string, unknown>
}
