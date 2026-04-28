// Gateway router — bridges incoming platform messages to Squan agents

import type { IncomingMessage, OutgoingMessage, PlatformType, PlatformConfig } from './types.js'

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

export interface GatewaySession {
  platform: PlatformType
  channelId: string
  userId: string
  userName: string
  agentId?: string
  projectId?: string
  createdAt: Date
  lastActivity: Date
}

// ---------------------------------------------------------------------------
// Router options — callbacks into the Squan core
// ---------------------------------------------------------------------------

export interface GatewayRouterOptions {
  /** Dispatch a new agent with a task description. Returns the new agent ID. */
  onDispatchAgent: (task: string, projectId?: string) => Promise<string>
  /** Send a text message to a running agent. Returns the agent's response. */
  onSendToAgent: (agentId: string, message: string) => Promise<string>
  /** List all active agents visible to the gateway. */
  onListAgents: () => Promise<Array<{ id: string; name: string; status: string }>>
  /** List all projects the gateway can target. */
  onListProjects: () => Promise<Array<{ id: string; name: string }>>
  /** (Optional) Stop / kill an agent. */
  onStopAgent?: (agentId: string) => Promise<void>
  /** (Optional) Get detailed status for an agent. */
  onAgentStatus?: (agentId: string) => Promise<{ id: string; name: string; status: string; task?: string }>
}

// ---------------------------------------------------------------------------
// GatewayRouter
// ---------------------------------------------------------------------------

export class GatewayRouter {
  private sessions = new Map<string, GatewaySession>()

  constructor(private options: GatewayRouterOptions) {}

  // -----------------------------------------------------------------------
  // Public
  // -----------------------------------------------------------------------

  /**
   * Primary entry point — handle any inbound message.
   * Returns the reply that should be sent back to the platform.
   */
  async handleMessage(msg: IncomingMessage, config?: PlatformConfig): Promise<OutgoingMessage> {
    // Access control
    const allowed = config?.settings.allowedUsers
    if (allowed && allowed.length > 0 && !allowed.includes(msg.platformUserId)) {
      return this.plain('⛔ You are not authorized to use this gateway.')
    }

    // Ensure session exists
    const session = this.ensureSession(msg)

    // Apply defaults from config
    if (config?.settings.defaultProjectId && !session.projectId) {
      session.projectId = config.settings.defaultProjectId
    }
    if (config?.settings.defaultAgentId && !session.agentId) {
      session.agentId = config.settings.defaultAgentId
    }

    const prefix = config?.settings.commandPrefix ?? '/'

    // Command handling
    if (this.isCommand(msg.text, prefix)) {
      const cmdResult = await this.handleCommand(msg, session, prefix, config)
      if (cmdResult) return cmdResult
    }

    // Regular message → route to agent
    return this.routeToAgent(msg, session, config)
  }

  /** Retrieve a session by key (mainly for testing / inspection). */
  getSession(platform: PlatformType, channelId: string): GatewaySession | undefined {
    return this.sessions.get(this.sessionKey(platform, channelId))
  }

  /** Remove a session. */
  removeSession(platform: PlatformType, channelId: string): boolean {
    return this.sessions.delete(this.sessionKey(platform, channelId))
  }

  /** All active sessions. */
  listSessions(): GatewaySession[] {
    return Array.from(this.sessions.values())
  }

  // -----------------------------------------------------------------------
  // Internals — command parsing
  // -----------------------------------------------------------------------

  private isCommand(text: string, prefix: string): boolean {
    const trimmed = text.trim()
    return trimmed.startsWith(prefix)
  }

  private async handleCommand(
    msg: IncomingMessage,
    session: GatewaySession,
    prefix: string,
    config?: PlatformConfig,
  ): Promise<OutgoingMessage | null> {
    const trimmed = msg.text.trim()
    const withoutPrefix = trimmed.slice(prefix.length)
    const parts = withoutPrefix.split(/\s+/)
    const command = (parts[0] ?? '').toLowerCase()
    const args = parts.slice(1).join(' ').trim()

    switch (command) {
      // ── List agents ──────────────────────────────────────────────────
      case 'agents':
      case 'list': {
        const agents = await this.options.onListAgents()
        if (agents.length === 0) {
          return this.md('📋 **No active agents.**\nUse `' + prefix + 'new <task>` to create one.')
        }
        const lines = agents.map(
          (a) => `• **${a.name}** (\`${a.id.slice(0, 8)}\`) — ${a.status}`,
        )
        const current = session.agentId
          ? `\nCurrently linked to \`${session.agentId.slice(0, 8)}\``
          : ''
        return this.md(`📋 **Active agents:**\n${lines.join('\n')}${current}`)
      }

      // ── List projects ────────────────────────────────────────────────
      case 'projects': {
        const projects = await this.options.onListProjects()
        if (projects.length === 0) {
          return this.md('📁 **No projects found.**')
        }
        const lines = projects.map((p) => `• **${p.name}** (\`${p.id.slice(0, 8)}\`)`)
        return this.md(`📁 **Projects:**\n${lines.join('\n')}`)
      }

      // ── New agent ────────────────────────────────────────────────────
      case 'new': {
        if (!args) {
          return this.plain(`Usage: ${prefix}new <task description>`)
        }
        try {
          const agentId = await this.options.onDispatchAgent(args, session.projectId)
          session.agentId = agentId
          session.lastActivity = new Date()
          return this.md(
            `🚀 **Agent dispatched!**\nID: \`${agentId.slice(0, 8)}\`\nTask: ${args}\n\nYou're now linked — send messages to interact.`,
          )
        } catch (err) {
          return this.plain(`❌ Failed to create agent: ${errorMessage(err)}`)
        }
      }

      // ── Switch agent ─────────────────────────────────────────────────
      case 'switch': {
        if (!args) {
          return this.plain(`Usage: ${prefix}switch <agent_id>`)
        }
        const targetId = args.trim()
        // Verify the agent exists
        const agents = await this.options.onListAgents()
        const match = agents.find(
          (a) => a.id === targetId || a.id.startsWith(targetId) || a.name === targetId,
        )
        if (!match) {
          return this.plain(`❌ Agent \`${targetId}\` not found. Use ${prefix}agents to list.`)
        }
        session.agentId = match.id
        session.lastActivity = new Date()
        return this.md(`🔀 Switched to **${match.name}** (\`${match.id.slice(0, 8)}\`) — ${match.status}`)
      }

      // ── Status ───────────────────────────────────────────────────────
      case 'status': {
        if (!session.agentId) {
          return this.plain('ℹ️ No agent linked. Use ' + prefix + 'new <task> or ' + prefix + 'switch <id>.')
        }
        if (this.options.onAgentStatus) {
          try {
            const info = await this.options.onAgentStatus(session.agentId)
            return this.md(
              `📊 **${info.name}** (\`${info.id.slice(0, 8)}\`)\nStatus: ${info.status}${info.task ? `\nTask: ${info.task}` : ''}`,
            )
          } catch {
            return this.plain(`📊 Linked to \`${session.agentId.slice(0, 8)}\` (status unavailable)`)
          }
        }
        // Fallback: just show what we know from the agents list
        const allAgents = await this.options.onListAgents()
        const linked = allAgents.find((a) => a.id === session.agentId)
        if (linked) {
          return this.md(`📊 **${linked.name}** (\`${linked.id.slice(0, 8)}\`) — ${linked.status}`)
        }
        return this.plain(`📊 Linked to \`${session.agentId.slice(0, 8)}\` (agent may have ended)`)
      }

      // ── Stop agent ───────────────────────────────────────────────────
      case 'stop': {
        if (!session.agentId) {
          return this.plain('ℹ️ No agent linked to stop.')
        }
        if (!this.options.onStopAgent) {
          return this.plain('⚠️ Stopping agents is not supported in this configuration.')
        }
        const stoppedId = session.agentId
        try {
          await this.options.onStopAgent(session.agentId)
          session.agentId = undefined
          return this.md(`🛑 Agent \`${stoppedId.slice(0, 8)}\` stopped. Session unlinked.`)
        } catch (err) {
          return this.plain(`❌ Failed to stop agent: ${errorMessage(err)}`)
        }
      }

      // ── Disconnect ───────────────────────────────────────────────────
      case 'disconnect': {
        const key = this.sessionKey(msg.platform, msg.channelId)
        this.sessions.delete(key)
        return this.plain('👋 Session ended. Send any message to start a new one.')
      }

      // ── Help ─────────────────────────────────────────────────────────
      case 'help': {
        return this.md(
          [
            '🤖 **Squan Gateway Commands**',
            '',
            `\`${prefix}agents\` / \`${prefix}list\` — List active agents`,
            `\`${prefix}projects\` — List available projects`,
            `\`${prefix}new <description>\` — Create a new agent with a task`,
            `\`${prefix}switch <agent_id>\` — Switch to a different agent`,
            `\`${prefix}status\` — Show current agent status`,
            `\`${prefix}stop\` — Stop the current agent`,
            `\`${prefix}disconnect\` — End this gateway session`,
            `\`${prefix}help\` — Show this message`,
            '',
            'Any non-command message is forwarded to your linked agent.',
          ].join('\n'),
        )
      }

      // ── Unknown command ──────────────────────────────────────────────
      default:
        return this.plain(`❓ Unknown command \`${prefix}${command}\`. Try ${prefix}help.`)
    }
  }

  // -----------------------------------------------------------------------
  // Internals — message routing
  // -----------------------------------------------------------------------

  private async routeToAgent(
    msg: IncomingMessage,
    session: GatewaySession,
    config?: PlatformConfig,
  ): Promise<OutgoingMessage> {
    // If no agent linked, try auto-dispatch
    if (!session.agentId) {
      const autoDispatch = config?.settings.autoDispatch ?? false
      if (autoDispatch) {
        try {
          const agentId = await this.options.onDispatchAgent(msg.text, session.projectId)
          session.agentId = agentId
          session.lastActivity = new Date()

          // Send the original message to the freshly created agent
          const response = await this.options.onSendToAgent(agentId, msg.text)
          return this.md(
            `🚀 _Auto-created agent \`${agentId.slice(0, 8)}\`_\n\n${response}`,
          )
        } catch (err) {
          return this.plain(`❌ Auto-dispatch failed: ${errorMessage(err)}`)
        }
      }

      const prefix = config?.settings.commandPrefix ?? '/'
      return this.md(
        `👋 **Welcome to Squan Gateway!**\nNo agent linked yet.\n\nUse \`${prefix}new <task>\` to create one, or \`${prefix}switch <id>\` to connect to an existing agent.\nType \`${prefix}help\` for all commands.`,
      )
    }

    // Enforce max concurrent agents per user
    const maxConcurrent = config?.settings.maxConcurrentAgents
    if (maxConcurrent && maxConcurrent > 0) {
      const userSessions = Array.from(this.sessions.values()).filter(
        (s) => s.userId === msg.platformUserId && s.agentId,
      )
      // Unique agent IDs for this user
      const uniqueAgents = new Set(userSessions.map((s) => s.agentId))
      if (uniqueAgents.size > maxConcurrent) {
        return this.plain(
          `⚠️ You have ${uniqueAgents.size} agents running (max ${maxConcurrent}). Stop one with /stop before creating more.`,
        )
      }
    }

    // Send to linked agent
    try {
      session.lastActivity = new Date()
      const response = await this.options.onSendToAgent(session.agentId, msg.text)
      return this.md(response)
    } catch (err) {
      return this.plain(`❌ Agent error: ${errorMessage(err)}`)
    }
  }

  // -----------------------------------------------------------------------
  // Session helpers
  // -----------------------------------------------------------------------

  private sessionKey(platform: PlatformType, channelId: string): string {
    return `${platform}:${channelId}`
  }

  private ensureSession(msg: IncomingMessage): GatewaySession {
    const key = this.sessionKey(msg.platform, msg.channelId)
    let session = this.sessions.get(key)
    if (!session) {
      session = {
        platform: msg.platform,
        channelId: msg.channelId,
        userId: msg.platformUserId,
        userName: msg.platformUserName,
        createdAt: new Date(),
        lastActivity: new Date(),
      }
      this.sessions.set(key, session)
    } else {
      session.lastActivity = new Date()
    }
    return session
  }

  // -----------------------------------------------------------------------
  // Response helpers
  // -----------------------------------------------------------------------

  private plain(text: string): OutgoingMessage {
    return { text, format: 'plain' }
  }

  private md(text: string): OutgoingMessage {
    return { text, format: 'markdown' }
  }
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
