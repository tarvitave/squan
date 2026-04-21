# Changelog

All notable changes to Squan are documented here.

## [2.4.0] - 2026-04-21

### ✨ Skills View
- Dedicated Skills page with 4 built-in workflows (Test→Fix→PR, Review→Refactor, Generate Docs, Security Audit)
- Create custom multi-step skills with role assignments
- Run skills to dispatch chained agent tasks

### ✨ Scheduler View
- Cron-based and event-driven job management
- Cron presets (hourly, daily, weekly, monthly)
- Event triggers (agent.completed, git.push, deploy.success, etc.)
- Enable/disable toggle, run-now, edit, delete

### 🐛 Claude Code Panel Fix
- Redesigned sidebar button with teal accent for better visibility
- Visual separator line before Claude Code button
- Button now uses contrasting background color (#f0fdfa) when inactive

## [2.3.0] - 2026-04-21

### 🎨 Branded App Icon
- Proper multi-size ICO (16/32/48/64/128/256) for Windows taskbar, alt-tab, and system tray
- Teal gradient "S" on rounded rectangle — matches Squan brand
- Dedicated tray PNGs for crisp system tray rendering
- Packager now embeds icon into the .exe binary

## [2.2.0] - 2026-04-21

### ✨ System Tray
- Branded system tray icon with server status indicator
- Context menu: version, server status, agent count, show/restart/browser/quit
- Single-click tray icon shows main window
- Tooltip shows live status and agent count

## [2.1.0] - 2026-04-21

### ✨ Claude Code Panel
- **Persistent left-side panel**: Claude Code terminal accessible alongside any view
- **Resizable**: Drag handle to adjust panel width (300–800px)
- **Keyboard shortcut**: Ctrl+` toggles panel open/closed
- **Platform-aware**: tmux on macOS/Linux, direct PTY on Windows
- **Shared WebSocket**: Terminal I/O routed through existing WS infrastructure

### 📦 Version Unification
- All packages (root, client, server) now share version 2.1.0
- Website, README, CHANGELOG all synchronized

## [0.5.0]

### 🍎 macOS Support
- Apple Silicon (M1/M2/M3/M4) DMG installer
- tmux-based persistent Claude Code sessions
- Gatekeeper bypass instructions included
 - 2026-04-15

### 🆕 MCP Extension Support
- **MCP Client**: Agents connect to external MCP tool servers (stdio + HTTP transports)
- **Extension Config UI**: Settings → Extensions tab to add/remove MCP servers
- **Tool Discovery**: Agents auto-discover tools from connected MCP servers
- **Prefixed Names**: MCP tools use `serverName__toolName` to avoid collisions
- Works with 1000+ community MCP servers (databases, Slack, Jira, GitHub, etc.)

### 🆕 Multi-Model Provider Support
- **Provider Abstraction**: Anthropic, OpenAI, Google Gemini, Ollama, OpenAI-compatible
- **Settings UI**: AI Provider tab with model grid and API key management
- **Per-user Config**: Each user can choose their own provider + model
- **Ollama**: Run local models with no API key needed
- **Cost Tracking**: Adjusted per-provider pricing

### 🆕 Built-in Skills (formerly Recipes)
- **Skill System**: Multi-step declarative workflows for chaining agent tasks
- **4 Built-in Skills**: Test→Fix→PR, Review→Refactor, Generate Docs, Security Audit
- **Skills API**: CRUD endpoints (`/api/skills`)
- Loadable from `.squan/skills/` directory per project

### 🆕 Web Browsing Tools
- **fetch_url**: HTTP GET with HTML→text conversion for readability
- **search_web**: DuckDuckGo instant answer API integration
- Both available as built-in tools for all agents

### 🔧 State Recovery on Restart
- `loadData()` retries 3x with exponential backoff (1s → 2s → 4s)
- Red error banner with Retry button if data fails to load
- Stale auth tokens auto-clear (forces re-login)
- Working/idle agents marked 'done' on restart (not zombie)
- Sidebar refresh button (↻) for manual data reload

### 🔧 Agent Chat Fix
- Fixed FollowUpInput pushed off-screen for long conversations
- Changed layout from `h-full` to `flex-1 min-h-0` for proper flex constraint

## [0.4.0] - 2026-04-14

### 🆕 Post-Completion Agent Interaction
- **Follow-up input bar** — always visible at the bottom of agent chat, allowing you to send follow-up questions or new instructions even after an agent finishes
- **Completion Action Bar** — inline card after agent completes with two clear paths:
  - "Mark Complete & Advance Board" — moves release train to PR Review
  - "or type below to continue" — keeps the conversation going
- **`POST /api/workerbees/:id/followup`** — server endpoint to resume agent conversations
- **`POST /api/workerbees/:id/mark-complete`** — server endpoint to manually advance kanban
- Agent child processes stay alive after completion (no `process.exit`) to support follow-up IPC messages

### 🔧 Kanban Board Improvements
- **Inline agent actions** — when agent is done but task still in "In Progress", shows "💬 View Chat" and "✓ Mark Complete" buttons directly on the card
- **Fixed status sync** — agent status now correctly propagates from server to kanban cards (fixed `workerbeeId` → `workerBeeId` camelCase mismatch in WebSocket events)
- **Client-side fallback** — `workerbee.done` event auto-advances assigned release train to PR Review in the store
- **Resilient field parsing** — WebSocket handler reads both `workerBeeId` and `workerbeeId` variants

### ✏️ Task Editor Improvements
- **Fixed focus jumping** — replaced callback ref with `useRef` + `useEffect` for one-time auto-focus (typing in description no longer jumps cursor to name field)
- **Larger text fields** — description textarea is now 4 rows with `min-h-[80px]`
- **Pop-out modal editor** — expand icon (↗) opens a full-screen modal with labeled fields for writing detailed agent instructions
- Agent name click in kanban now navigates directly to Agent chat view

## [0.3.11] - 2026-04-13

### Fixed
- API retry logic: 429/529 overload errors auto-retry with exponential backoff (5s, 15s, 30s)
- Fixed Unicode corruption in AgentChat (arrows showed as garbled text)
- Fixed charter query (project_id vs rig_id column mismatch)

## [0.3.10] - 2026-04-13

### Fixed
- Charters query uses `project_id` not `rig_id`
- Persist agent messages to DB for chat history
- Status sync between agent and kanban
- Unicode rendering in agent chat
- Suppress error flash on agent start

## [0.3.9] - 2026-04-13

### Fixed
- DB column name (`assigned_workerbee_id`)
- Agent chat shows conversation history
- Error flash suppressed during startup

## [0.3.8] - 2026-04-13

### Fixed
- 5 issues: clickable agents, settings cleanup, error flash, status sync, PR review auto-advance

## [0.3.7] - 2026-04-13

### Changed
- Help menu links to squan.dev and Colin Wynd LinkedIn
- Removed Claude Code from View menu

## [0.3.6] - 2026-04-13

### Changed
- Error flash on agent start suppressed
- Renamed Terminals to Agents in sidebar
- Removed Claude Code panel

## [0.3.5] - 2026-04-13

### Changed
- Auto-move release train to PR Review when agent completes
- Dispatch toast uses info style instead of error

## [0.3.4] - 2026-04-13

### Changed
- Sidebar nav: Terminals → Agents (with Bot icon)
- Claude Code view removed
- Command palette updated
- Keyboard shortcuts 1-6 instead of 1-7

## [0.3.3] - 2026-04-13

### Fixed
- `__dirname` in ESM for process-manager
- KanbanView input focus with delayed ref
- Kill + remove agent in sidebar

## [0.3.2] - 2026-04-13

### Fixed
- Kill removes agent from sidebar
- Kanban dispatch works with loading state + toast + auto-switch to Agents view
- SQ taskbar icon

## [0.3.0] - 2026-04-13

### 🆕 Major: Child Process Isolation
- Each agent runs in a separate Node.js child process
- Kill button in sidebar for running agents
- Full process isolation and independent lifecycle

## [0.2.12] - 2026-04-12

### 🆕 Major: No More Claude CLI
- **NUCLEAR:** Completely removed PTY/terminal system
- Stubbed out ptyManager — agents use ONLY DirectRunner
- Terminal API endpoints return empty/410
- Zero possibility of spawning `claude.exe`

## [0.2.8] - 2026-04-12

### 🆕 Major: Direct API 
- **DirectRunner**: Calls Anthropic API directly instead of CLI
- **New AgentChat UI**: Left-aligned AI messages, right-aligned dark pills, expandable tool cards
- Loading indicator with animated bouncing dots
- Removed all `workerBeeManager.spawn` calls (zero CLI usage)

## [0.2.4] - 2026-04-12

### Added
- Structured runner with init-squan CLI commands
- GitHub repos API integration
- Pass ANTHROPIC_API_KEY to runner (prevents OAuth login prompt)

## [0.2.0] - 2026-04-11

### 🆕 Initial Release
- Multi-agent orchestration with Claude Code CLI
- Kanban board (Open → In Progress → PR Review → Landed)
- Git worktree isolation per agent
- Everything-as-Code (`.squan/` directory)
- Electron desktop app
- GitHub integration (browse, create, clone repos)
- Real-time WebSocket events
- `sq>` console
- Command palette
- Metrics, Events, Costs views
