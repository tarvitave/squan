// Gateway manager — lifecycle management for all platform adapters

import type {
  PlatformConfig,
  PlatformAdapter,
  PlatformType,
  AdapterStatus,
  IncomingMessage,
  OutgoingMessage,
} from './types.js'
import { GatewayRouter, type GatewayRouterOptions } from './router.js'

// ---------------------------------------------------------------------------
// Platform metadata (display names & descriptions for all supported types)
// ---------------------------------------------------------------------------

const PLATFORM_META: Record<PlatformType, { name: string; description: string }> = {
  telegram:    { name: 'Telegram',       description: 'Telegram Bot API' },
  discord:     { name: 'Discord',        description: 'Discord bot via gateway or webhooks' },
  slack:       { name: 'Slack',          description: 'Slack app with Events API' },
  whatsapp:    { name: 'WhatsApp',       description: 'WhatsApp Business API / Cloud API' },
  signal:      { name: 'Signal',         description: 'Signal Messenger via signal-cli or REST' },
  matrix:      { name: 'Matrix',         description: 'Matrix protocol (Element, etc.)' },
  mattermost:  { name: 'Mattermost',     description: 'Mattermost bot integration' },
  teams:       { name: 'Microsoft Teams', description: 'Teams bot via Bot Framework' },
  email:       { name: 'Email',          description: 'IMAP/SMTP email gateway' },
  wechat:      { name: 'WeChat',         description: 'WeChat Official Account API' },
  wecom:       { name: 'WeCom',          description: 'WeCom (WeChat Work) API' },
  dingtalk:    { name: 'DingTalk',       description: 'DingTalk robot API' },
  feishu:      { name: 'Feishu / Lark',  description: 'Feishu (Lark) bot API' },
  line:        { name: 'LINE',           description: 'LINE Messaging API' },
  qqbot:       { name: 'QQ Bot',         description: 'QQ official bot platform' },
  imessage:    { name: 'iMessage',       description: 'iMessage via AppleScript bridge (macOS)' },
  irc:         { name: 'IRC',            description: 'IRC client connection' },
}

// ---------------------------------------------------------------------------
// Event callback type (for external listeners)
// ---------------------------------------------------------------------------

export type GatewayEventType =
  | 'adapter:connected'
  | 'adapter:disconnected'
  | 'adapter:error'
  | 'message:received'
  | 'message:sent'

export type GatewayEventHandler = (event: {
  type: GatewayEventType
  platform: PlatformType
  data?: unknown
}) => void

// ---------------------------------------------------------------------------
// GatewayManager
// ---------------------------------------------------------------------------

export class GatewayManager {
  private adapters = new Map<PlatformType, PlatformAdapter>()
  private configs = new Map<PlatformType, PlatformConfig>()
  private router: GatewayRouter
  private eventHandlers: GatewayEventHandler[] = []

  constructor(routerOptions: GatewayRouterOptions) {
    this.router = new GatewayRouter(routerOptions)
  }

  // -----------------------------------------------------------------------
  // Adapter registration
  // -----------------------------------------------------------------------

  /** Register a platform adapter (does not start it). */
  registerAdapter(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`Adapter for ${adapter.platform} is already registered`)
    }
    this.adapters.set(adapter.platform, adapter)
  }

  /** Unregister a platform adapter (stops it first if connected). */
  async unregisterAdapter(platform: PlatformType): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    if (adapter.status === 'connected' || adapter.status === 'connecting') {
      await this.stopPlatform(platform)
    }
    this.adapters.delete(platform)
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Start a single platform with the given config. */
  async startPlatform(platform: PlatformType, config: PlatformConfig): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      throw new Error(
        `No adapter registered for ${platform}. Register one with registerAdapter() first.`,
      )
    }

    // Validate required credentials
    const info = adapter.getInfo()
    const missing = info.requiredCredentials.filter((key) => !config.credentials[key])
    if (missing.length > 0) {
      throw new Error(
        `Missing required credentials for ${platform}: ${missing.join(', ')}`,
      )
    }

    // Store config
    this.configs.set(platform, { ...config, platform, enabled: true })

    // Wire up the message handler before connecting
    adapter.onMessage(async (msg: IncomingMessage) => {
      this.emit({ type: 'message:received', platform, data: msg })

      const platformConfig = this.configs.get(platform)
      const reply = await this.router.handleMessage(msg, platformConfig)

      try {
        const sentId = await adapter.send(msg.channelId, reply)
        this.emit({ type: 'message:sent', platform, data: { channelId: msg.channelId, messageId: sentId } })
      } catch (sendErr) {
        console.error(`[gateway] Failed to send reply on ${platform}:`, sendErr)
        this.emit({ type: 'adapter:error', platform, data: sendErr })
      }
    })

    // Connect
    try {
      await adapter.connect(config)
      this.emit({ type: 'adapter:connected', platform })
    } catch (err) {
      this.emit({ type: 'adapter:error', platform, data: err })
      throw err
    }
  }

  /** Stop a single platform. */
  async stopPlatform(platform: PlatformType): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return

    try {
      await adapter.disconnect()
    } catch (err) {
      console.error(`[gateway] Error disconnecting ${platform}:`, err)
    }

    // Mark config disabled
    const cfg = this.configs.get(platform)
    if (cfg) {
      cfg.enabled = false
    }

    this.emit({ type: 'adapter:disconnected', platform })
  }

  /** Start all adapters that have stored configs with enabled: true. */
  async startAll(): Promise<void> {
    const results: Array<{ platform: PlatformType; error?: unknown }> = []

    for (const [platform, config] of this.configs) {
      if (!config.enabled) continue
      if (!this.adapters.has(platform)) continue

      try {
        await this.startPlatform(platform, config)
        results.push({ platform })
      } catch (err) {
        results.push({ platform, error: err })
        console.error(`[gateway] Failed to start ${platform}:`, err)
      }
    }

    const failed = results.filter((r) => r.error)
    if (failed.length > 0) {
      console.warn(
        `[gateway] ${failed.length}/${results.length} adapters failed to start:`,
        failed.map((f) => f.platform).join(', '),
      )
    }
  }

  /** Stop all connected adapters. */
  async stopAll(): Promise<void> {
    const stopping = Array.from(this.adapters.keys()).map((platform) =>
      this.stopPlatform(platform).catch((err) => {
        console.error(`[gateway] Error stopping ${platform}:`, err)
      }),
    )
    await Promise.all(stopping)
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /** Update (merge) config for a platform. Restarts the adapter if it was running. */
  async updateConfig(platform: PlatformType, partial: Partial<PlatformConfig>): Promise<void> {
    const existing = this.configs.get(platform)
    const merged: PlatformConfig = {
      platform,
      enabled: partial.enabled ?? existing?.enabled ?? false,
      credentials: { ...existing?.credentials, ...partial.credentials },
      settings: { ...existing?.settings, ...partial.settings },
    }
    this.configs.set(platform, merged)

    // If the adapter is currently connected, restart with new config
    const adapter = this.adapters.get(platform)
    if (adapter && (adapter.status === 'connected' || adapter.status === 'connecting')) {
      await this.stopPlatform(platform)
      if (merged.enabled) {
        await this.startPlatform(platform, merged)
      }
    }
  }

  /** Store a config without starting the adapter. */
  setConfig(platform: PlatformType, config: PlatformConfig): void {
    this.configs.set(platform, { ...config, platform })
  }

  /** Retrieve stored config for a platform. */
  getConfig(platform: PlatformType): PlatformConfig | undefined {
    return this.configs.get(platform)
  }

  // -----------------------------------------------------------------------
  // Status & introspection
  // -----------------------------------------------------------------------

  /** Status snapshot of every registered adapter. */
  getStatus(): Array<{
    platform: PlatformType
    status: AdapterStatus
    config?: PlatformConfig
  }> {
    const result: Array<{ platform: PlatformType; status: AdapterStatus; config?: PlatformConfig }> = []

    for (const [platform, adapter] of this.adapters) {
      result.push({
        platform,
        status: adapter.status,
        config: this.configs.get(platform),
      })
    }

    // Also include configured-but-unregistered platforms (status: disconnected)
    for (const [platform, config] of this.configs) {
      if (!this.adapters.has(platform)) {
        result.push({ platform, status: 'disconnected', config })
      }
    }

    return result
  }

  /** List all supported platforms with metadata and required credentials. */
  getSupportedPlatforms(): Array<{
    platform: PlatformType
    name: string
    description: string
    requiredCredentials: string[]
    registered: boolean
  }> {
    return (Object.entries(PLATFORM_META) as Array<[PlatformType, { name: string; description: string }]>).map(
      ([platform, meta]) => {
        const adapter = this.adapters.get(platform)
        const info = adapter?.getInfo()
        return {
          platform,
          name: info?.name ?? meta.name,
          description: info?.description ?? meta.description,
          requiredCredentials: info?.requiredCredentials ?? [],
          registered: !!adapter,
        }
      },
    )
  }

  /** Directly access the router (e.g. to inspect sessions). */
  getRouter(): GatewayRouter {
    return this.router
  }

  /** Get a registered adapter by platform. */
  getAdapter(platform: PlatformType): PlatformAdapter | undefined {
    return this.adapters.get(platform)
  }

  // -----------------------------------------------------------------------
  // Send a message directly (bypassing the router, useful for notifications)
  // -----------------------------------------------------------------------

  /** Send an outgoing message directly on a platform/channel. */
  async sendDirect(
    platform: PlatformType,
    channelId: string,
    message: OutgoingMessage,
  ): Promise<string> {
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      throw new Error(`No adapter registered for ${platform}`)
    }
    if (adapter.status !== 'connected') {
      throw new Error(`Adapter for ${platform} is not connected (status: ${adapter.status})`)
    }
    return adapter.send(channelId, message)
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  /** Subscribe to gateway lifecycle events. */
  on(handler: GatewayEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      const idx = this.eventHandlers.indexOf(handler)
      if (idx !== -1) this.eventHandlers.splice(idx, 1)
    }
  }

  private emit(event: { type: GatewayEventType; platform: PlatformType; data?: unknown }): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch (err) {
        console.error('[gateway] Event handler error:', err)
      }
    }
  }
}
