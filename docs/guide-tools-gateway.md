# Squan v2.8.0 — Tools & Gateway Guide

## 53 Built-in Tools

Squan agents now have **53 built-in tools** organized into 7 categories. Every agent automatically discovers all tools — no configuration needed.

### Tool Categories

#### 🗂️ Filesystem (15 tools)

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write/create a file |
| `edit_file` | Find and replace text in a file |
| `list_directory` | List directory contents |
| `search_files` | Search for text patterns across files (like grep) |
| `file_tree` | Show directory tree with indentation |
| `file_stat` | Get file metadata (size, modified date, type) |
| `glob_files` | Find files matching a glob pattern (e.g. `**/*.ts`) |
| `diff_files` | Show unified diff between two files |
| `copy_file` | Copy a file or directory |
| `move_file` | Move or rename a file or directory |
| `delete_file` | Delete a file or directory |
| `archive_create` | Create a zip or tar.gz archive |
| `archive_extract` | Extract an archive |
| `file_checksum` | Calculate SHA-256 hash of a file |

**Example task:** *"Scan all TypeScript files, find unused exports, and delete them."*

#### 🔀 Git (12 tools)

| Tool | Description |
|------|-------------|
| `git_status` | Show staged, unstaged, and untracked files |
| `git_diff` | Show diff of changes (staged or unstaged) |
| `git_log` | Show commit history with filters |
| `git_branch` | List, create, switch, or delete branches |
| `git_commit` | Stage files and commit with a message |
| `git_stash` | Push, pop, list, or drop stashes |
| `git_blame` | Show per-line blame with optional line range |
| `git_cherry_pick` | Cherry-pick a commit by hash |
| `git_merge` | Merge a branch (with optional --no-ff) |
| `git_tag` | List or create tags |
| `git_remote` | List remotes with URLs |
| `git_reset` | Reset HEAD (soft, mixed, or hard) |

**Example task:** *"Create a release branch, bump the version in package.json, commit, tag v2.8.0, and push."*

#### 🔍 Code Analysis (7 tools)

| Tool | Description |
|------|-------------|
| `find_symbols` | Find function/class/interface definitions (supports TS, Python, Rust, Go, Java, C#) |
| `find_references` | Find all references to a symbol across the project |
| `code_metrics` | Calculate LOC, comments, functions, classes per file |
| `dependency_graph` | Show import/require dependency tree for a file |
| `lint_check` | Basic static analysis (unused imports, console.logs, TODOs, long lines, deep nesting) |
| `ast_outline` | Get structured outline of exports, functions, classes |
| `find_duplicates` | Find duplicate code blocks across files |

**Example task:** *"Find all unused functions across the codebase and remove them."*  
The agent will use `find_symbols` → `find_references` → `delete_file/edit_file`.

#### 🌐 Network (7 tools)

| Tool | Description |
|------|-------------|
| `fetch_url` | Fetch a URL, auto-convert HTML to text |
| `search_web` | Search the web via DuckDuckGo API |
| `http_request` | Make arbitrary HTTP requests (GET, POST, PUT, DELETE) |
| `download_file` | Download a file from a URL to disk |
| `dns_lookup` | DNS resolution (A, AAAA, MX, TXT, NS, CNAME) |
| `url_screenshot` | Take a screenshot of a URL (requires Chrome/Edge) |
| `check_port` | Check if a TCP port is open |

**Example task:** *"Fetch the Stripe API docs, then build a payment integration."*

#### 🗄️ Database (4 tools)

| Tool | Description |
|------|-------------|
| `query_sqlite` | Execute SQL on a SQLite database |
| `list_tables` | List all tables with row counts |
| `describe_table` | Show table schema (columns, types, indexes) |
| `query_csv` | Query CSV files with SQL-like syntax |

**Example task:** *"Examine the database schema, write a migration to add a `status` column to the `orders` table, and run it."*

#### 💻 System (8 tools)

| Tool | Description |
|------|-------------|
| `system_info` | OS, architecture, CPU, memory, uptime |
| `env_vars` | List or get environment variables (filters sensitive values) |
| `process_list` | List running processes with filter/sort |
| `disk_usage` | Show disk space for a path |
| `network_info` | Show network interfaces and IPs |
| `kill_process` | Kill a process by PID |
| `open_url` | Open a URL in the default browser |
| `clipboard` | Read or write to the system clipboard |

#### 🤝 Agent Coordination (8 tools)

| Tool | Description |
|------|-------------|
| `delegate_task` | Request a new agent be spawned for a subtask |
| `ask_agent` | Send a question to another running agent |
| `share_context` | Share information with all agents on the same project |
| `read_shared_context` | Read shared context from other agents |
| `create_skill` | Save the current workflow as a reusable skill template |
| `notify_user` | Send a notification to the user |
| `request_review` | Request human review before continuing |
| `task_complete` | Signal that the task is finished |

**Example task:** *"Build a REST API with auth, database, and tests."*  
The lead agent delegates:
1. Agent A → Routes and controllers
2. Agent B → Database models and migrations
3. Agent C → Tests and CI config

They share context via `share_context` (e.g., Agent B shares the database schema so Agent A knows the column names).

### How Tools Work

1. **Automatic discovery** — When an agent starts, it receives all 53 tool definitions. No setup required.
2. **MCP tools extend** — If you've configured MCP extensions in Settings, those tools are merged with the 53 built-in tools. An agent might have 100+ tools.
3. **Any provider** — Tools work with all AI providers: Anthropic Claude, OpenAI GPT-4o, Google Gemini, Ollama local models.
4. **Same tools everywhere** — Whether you dispatch from the desktop app, the console, or a messaging platform, agents get the same tools.

---

## 17 Messaging Platforms

Talk to your Squan agents from any messaging platform. The gateway routes messages between platforms and your running agents.

### How It Works

```
You (Telegram/Discord/Slack/etc.)
    │
    ▼
Platform Adapter (connects to the platform's API)
    │
    ▼
Gateway Router (manages sessions, parses commands)
    │
    ▼
Squan Agent (works on your code in a git worktree)
    │
    ▼
Response sent back through the same platform
```

### Supported Platforms

| Platform | Protocol | Required Credentials |
|----------|----------|---------------------|
| **Telegram** | Bot API (long poll) | `bot_token` — get from @BotFather |
| **Discord** | WebSocket Gateway | `bot_token`, `application_id` — discord.com/developers |
| **Slack** | Socket Mode | `bot_token`, `app_token` — api.slack.com/apps |
| **WhatsApp** | Cloud API (webhook) | `access_token`, `phone_number_id`, `verify_token` — Meta Business |
| **Signal** | REST API | `signal_api_url`, `phone_number` — run signal-cli-rest-api |
| **Matrix** | Client-Server API | `homeserver_url`, `access_token` |
| **Mattermost** | REST + WebSocket | `server_url`, `access_token` |
| **Microsoft Teams** | Bot Framework | `app_id`, `app_password`, `tenant_id` — Azure Portal |
| **Email** | IMAP + SMTP | `imap_host`, `smtp_host`, `email_address`, `email_password` |
| **WeChat** | Official Account API | `app_id`, `app_secret`, `token`, `encoding_aes_key` |
| **WeCom** | Enterprise API | `corp_id`, `corp_secret`, `agent_id`, `token` |
| **DingTalk** | Robot API | `app_key`, `app_secret`, `robot_code` |
| **Feishu/Lark** | Open API | `app_id`, `app_secret`, `verification_token` |
| **LINE** | Messaging API | `channel_access_token`, `channel_secret` |
| **QQBot** | WebSocket Gateway | `app_id`, `app_secret` |
| **iMessage** | BlueBubbles REST | `server_url`, `password` — requires Mac with BlueBubbles |
| **IRC** | Raw TCP/TLS | `server`, `port`, `nickname`, `channels` |

### Setup (Telegram Example)

1. **Create a Telegram bot:**
   - Open Telegram, message `@BotFather`
   - Send `/newbot` and follow the prompts
   - Copy the bot token (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v`)

2. **Configure in Squan:**
   - Open Squan → Settings → Gateway
   - Select Telegram
   - Paste your bot token
   - Toggle "Enabled"
   - (Optional) Set allowed users, default project, auto-dispatch

3. **Start chatting:**
   - Open your new bot in Telegram
   - Send `/new Fix the login page CSS on mobile`
   - Squan dispatches an agent and sends updates back to Telegram

### Slash Commands

These commands work on **every** platform:

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/agents` or `/list` | List all active agents with status |
| `/projects` | List available projects |
| `/new <description>` | Create a new agent with the given task |
| `/switch <agent_id>` | Switch to a different agent |
| `/status` | Show current agent's status and progress |
| `/stop` | Stop the current agent |
| `/disconnect` | End the gateway session |

### Example Conversation (Telegram)

```
You: /projects
Squan: 📁 Projects:
  1. my-webapp (main branch, 12 tasks)
  2. api-server (main branch, 3 tasks)

You: /new Fix the login page CSS — the form is broken on mobile
Squan: ✅ Agent bee-alpha dispatched!
  📋 Task: Fix the login page CSS — the form is broken on mobile
  📁 Project: my-webapp (auto-selected)

You: Also make the submit button bigger
Squan: 📨 Message sent to bee-alpha.

(30 seconds later)

Squan: ✅ bee-alpha completed!
  📝 Fixed responsive CSS for login form:
  - Set max-width: 400px with 16px padding
  - Changed flex-direction to column on mobile
  - Increased submit button to 48px height
  📁 Files: src/pages/Login.css, src/components/Button.css
  ⏱️ 32 seconds | $0.04

You: /status
Squan: 🟢 bee-alpha — Done
  📊 2 files changed, 45 additions, 12 deletions
  💰 $0.04 (1,200 input + 800 output tokens)
```

### Access Control

- **allowedUsers** — Whitelist specific platform user IDs. Empty = allow everyone.
- **maxConcurrentAgents** — Limit how many agents a single user can run at once.
- **autoDispatch** — If enabled, any non-command message auto-creates an agent. If disabled, users must use `/new`.
- **defaultProjectId** — Automatically assign new tasks to a specific project.

### Tips

- **One session per channel** — Each platform channel/DM maintains its own agent session.
- **Thread support** — On Discord, Slack, and Mattermost, threads become separate sessions.
- **Long messages split** — Responses over the platform's limit (4096 chars for Telegram, 2000 for Discord) are automatically split.
- **Markdown formatting** — Responses use platform-native formatting (MarkdownV2 for Telegram, mrkdwn for Slack, etc.).

---

## Architecture

### Tool Registry

```
server/src/tools/
├── registry.ts        — ToolRegistry class (register, discover, execute)
├── index.ts           — Imports all categories, exports convenience functions
├── filesystem.ts      — 15 file system tools
├── git.ts             — 12 git tools
├── code-analysis.ts   — 7 code analysis tools
├── network.ts         — 7 network tools
├── database.ts        — 4 database tools
├── system.ts          — 8 system tools
└── agent.ts           — 8 agent coordination tools
```

Adding a new tool:
1. Open the appropriate category file (e.g., `filesystem.ts`)
2. Add a tool definition + handler to the `tools` array
3. That's it — agents discover it automatically

### Gateway

```
server/src/gateway/
├── types.ts           — PlatformAdapter interface, message types
├── router.ts          — GatewayRouter (sessions, commands, agent routing)
├── manager.ts         — GatewayManager (adapter lifecycle, config)
├── index.ts           — Re-exports
└── adapters/
    ├── telegram.ts    — Telegram Bot API adapter
    ├── discord.ts     — Discord Gateway WebSocket adapter
    ├── slack.ts       — Slack Socket Mode adapter
    ├── whatsapp.ts    — WhatsApp Cloud API adapter
    ├── signal.ts      — Signal CLI REST API adapter
    ├── matrix.ts      — Matrix Client-Server API adapter
    ├── mattermost.ts  — Mattermost REST + WebSocket adapter
    ├── teams.ts       — Microsoft Teams Bot Framework adapter
    ├── email.ts       — IMAP/SMTP email adapter
    ├── wechat.ts      — WeChat Official Account adapter
    ├── wecom.ts       — WeCom Enterprise API adapter
    ├── dingtalk.ts    — DingTalk Robot adapter
    ├── feishu.ts      — Feishu/Lark Open API adapter
    ├── line.ts        — LINE Messaging API adapter
    ├── qqbot.ts       — QQ Bot WebSocket adapter
    ├── imessage.ts    — iMessage via BlueBubbles adapter
    ├── irc.ts         — Raw IRC protocol adapter
    └── index.ts       — Re-exports all adapters
```

Adding a new platform:
1. Create `adapters/myplatform.ts` implementing `PlatformAdapter`
2. Add it to `adapters/index.ts`
3. Register it in `manager.ts` supported platforms list
