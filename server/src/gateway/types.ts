// Gateway types — bridges messaging platforms to Squan's agent system

/** A message arriving from any messaging platform */
export interface IncomingMessage {
  platform: PlatformType
  platformUserId: string
  platformUserName: string
  channelId: string
  messageId: string
  text: string
  attachments?: Attachment[]
  replyTo?: string
  timestamp: Date
  raw?: unknown
}

/** A message being sent out to a platform */
export interface OutgoingMessage {
  text: string
  format?: 'plain' | 'markdown' | 'html'
  attachments?: Attachment[]
  replyTo?: string
}

export interface Attachment {
  type: 'image' | 'file' | 'code' | 'voice'
  url?: string
  data?: Buffer
  filename?: string
  mimeType?: string
  /** Language hint for code blocks */
  language?: string
}

export type PlatformType =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'mattermost'
  | 'teams'
  | 'email'
  | 'wechat'
  | 'wecom'
  | 'dingtalk'
  | 'feishu'
  | 'line'
  | 'qqbot'
  | 'imessage'
  | 'irc'

export type AdapterStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Configuration for a platform adapter */
export interface PlatformConfig {
  platform: PlatformType
  enabled: boolean
  credentials: Record<string, string>
  settings: {
    /** Whitelist of platform user IDs allowed to interact (empty = allow all) */
    allowedUsers?: string[]
    /** Route messages to this agent by default */
    defaultAgentId?: string
    /** Default project for new tasks */
    defaultProjectId?: string
    /** Command prefix, e.g. "/" or "!" */
    commandPrefix?: string
    /** Automatically create agents for new message threads */
    autoDispatch?: boolean
    /** Max concurrent agents a single user can run */
    maxConcurrentAgents?: number
    /** How sessions are scoped */
    sessionMode?: 'thread' | 'dm' | 'channel'
  }
}

/** Contract every platform adapter must implement */
export interface PlatformAdapter {
  platform: PlatformType
  status: AdapterStatus

  /** Connect to the platform */
  connect(config: PlatformConfig): Promise<void>

  /** Disconnect from the platform */
  disconnect(): Promise<void>

  /** Send a message; returns the platform message ID */
  send(channelId: string, message: OutgoingMessage): Promise<string>

  /** Edit a previously sent message (optional — not all platforms support it) */
  edit?(messageId: string, channelId: string, message: OutgoingMessage): Promise<void>

  /** React to a message with an emoji (optional) */
  react?(messageId: string, channelId: string, emoji: string): Promise<void>

  /** Register the handler that receives inbound messages */
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void

  /** Metadata for UI display and configuration screens */
  getInfo(): {
    name: string
    description: string
    requiredCredentials: string[]
    optionalSettings: string[]
  }
}
