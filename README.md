# Squan

**Multi-agent AI development command center.**

Squan orchestrates multiple AI agents working in parallel across your git repositories. Create tasks, dispatch agents, interact with them in real-time, and watch them build — all from a single desktop app.

![Squan](https://img.shields.io/badge/version-0.4.0-teal) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## What's New in v0.4.0

### 🔄 Post-Completion Agent Interaction
- **Follow-up questions** — keep chatting with agents after they finish
- **Mark Complete** button — manually advance tasks through the kanban board
- Agents stay alive after completion — resume conversations anytime

### 🤖 Direct API Agents
- Agents call the Anthropic API directly (like Goose) — no CLI spawning
- Faster, more reliable, zero OAuth issues
- Each agent runs in an isolated child process

### 📋 Smarter Kanban
- Real-time status sync between agents and kanban cards
- Agent completion auto-advances cards to PR Review
- Inline "View Chat" and "Mark Complete" actions on kanban cards

### ✏️ Better Task Editor
- Larger description fields with auto-resize
- Pop-out modal editor for writing detailed instructions
- Fixed input focus issues

---

## Features

### 🤖 Multi-Agent Orchestration
- Dispatch multiple AI agents to work on tasks simultaneously
- Each agent works in an isolated git worktree — no conflicts
- Monitor agent progress in real-time via Goose-style chat interface
- **NEW:** Interact with agents after they complete — ask follow-up questions or give more instructions

### 📋 Kanban Board
- Visual task management with 5 columns: Open → In Progress → PR Review → Landed → Cancelled
- Auto-updates as agents complete work
- **NEW:** "Mark Complete" button to manually advance tasks
- **NEW:** Inline agent status and quick actions on cards

### 💬 Agent Chat (Goose-style)
- Left-aligned AI messages with expandable tool call cards
- Right-aligned user messages in dark pills
- Real-time streaming with loading indicators
- **NEW:** Always-visible follow-up input bar
- **NEW:** Completion action bar — choose to continue chatting or mark complete

### 📁 Everything-as-Code
- All project state stored in `.squan/` directory inside your repo
- Tasks are markdown files with YAML frontmatter
- Every change is a git commit — full audit trail

### 🖥 Desktop App
- Electron-based — double-click to run
- Embedded server starts automatically
- No terminal, no npm, no Node.js required

### 🔗 GitHub Integration
- Browse and add repos from your GitHub account
- Create new repos directly from Squan
- Auto-clone repos to your workspace
- Create PRs from agent work

### 📊 Monitoring
- **Events**: Real-time stream of all agent activity
- **Metrics**: Agent success rates, task completion stats
- **Costs**: Token usage and API spend tracking per agent
- **Status Bar**: Live connection, agent count, and cost display

### ⌨ Power User Features
- `sq>` console for CLI-style control
- Command palette (⌘K / Ctrl+K)
- Keyboard shortcuts for all views (⌘1-6)
- Standby templates for one-click task dispatch

---

## Quick Start

### Option 1: Binary (recommended)

Download the latest release from [Releases](https://github.com/tarvitave/squan/releases) and run `Squan.exe` (Windows) or `Squan.app` (macOS).

### Option 2: From source

```bash
git clone https://github.com/tarvitave/squan.git
cd squan
npm install
npm start
```

This builds the server, client, and Electron shell, then launches the app.

### Option 3: Docker (web deployment)

```bash
git clone https://github.com/tarvitave/squan.git
cd squan
cp .env.example .env  # Configure your settings
docker-compose up -d
```

Access at `http://localhost:80`.

### Option 4: Development mode

```bash
npm run dev
```

Opens the client on `http://localhost:3000` with hot reload, proxying to the server on `:3001`.

---

## Architecture

```
Squan.exe (Electron)
  └── Embedded Server (Node.js/Express)
       ├── REST API (:3001)
       ├── WebSocket (real-time events)
       ├── SQLite database (state cache)
       ├── Process Manager (agent child processes)
       └── Serves React client (static files)

Per-agent (isolated child process):
  └── Git worktree (isolated copy of repo)
       ├── CLAUDE.md (task instructions)
       ├── DirectRunner (Anthropic API client)
       └── Tool execution (read/write/edit files, run commands, search)
```

### How Agents Work

1. **Dispatch** — Squan creates a git worktree and writes `CLAUDE.md` with the task
2. **Spawn** — A child process starts with the DirectRunner (calls Anthropic API directly)
3. **Work** — The agent reads files, writes code, runs commands, makes commits
4. **Complete** — Agent signals `task_complete` or finishes naturally
5. **Interact** — You can ask follow-up questions or give more instructions
6. **Advance** — Click "Mark Complete" to move the task to PR Review on the kanban

### Everything-as-Code (`.squan/` directory)

```
your-project/
├── .squan/
│   ├── config.yaml              # Project settings
│   ├── board/                   # Kanban board
│   │   ├── open/                # Tasks ready to work on
│   │   │   └── 001-add-auth.md  # Each task = markdown file
│   │   ├── in_progress/
│   │   ├── pr_review/
│   │   ├── landed/
│   │   └── cancelled/
│   ├── charters/                # Agent knowledge per role
│   ├── templates/               # Reusable task templates
│   └── docs/                    # Project documentation
├── src/
└── package.json
```

---

## Agent Interaction Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Create Task │────>│  Dispatch    │────>│  Agent Working   │
│  (Kanban)    │     │  Agent       │     │  (Chat visible)  │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          Agent completes
                                                   │
                                         ┌─────────▼─────────┐
                                         │  Completion Bar    │
                                         │  ┌───────────────┐ │
                                         │  │ Mark Complete  │ │
                                         │  │ & Advance Board│ │
                                         │  └───────────────┘ │
                                         │  OR                │
                                         │  ┌───────────────┐ │
                                         │  │ Type follow-up │ │
                                         │  │ instructions   │ │
                                         │  └───────────────┘ │
                                         └─────────┬─────────┘
                                                   │
                              ┌─────────────────────┼─────────────────────┐
                              │                     │                     │
                     ┌────────▼────────┐  ┌─────────▼────────┐  ┌────────▼────────┐
                     │  PR Review      │  │  Agent resumes   │  │  More follow-up │
                     │  (Kanban card)  │  │  working          │  │  questions      │
                     └────────┬────────┘  └──────────────────┘  └─────────────────┘
                              │
                     ┌────────▼────────┐
                     │  Landed         │
                     └─────────────────┘
```

---

## Tutorials

- **[Tutorial 1: Using Squan via the UI](docs/tutorial-01-ui.md)** — Step-by-step walkthrough creating a project using the graphical interface
- **[Tutorial 2: Using Squan via the Console & CLI](docs/tutorial-02-cli.md)** — Same project built entirely from the `sq>` console

---

## Building

### Development

```bash
npm run dev          # Server (:3001) + Client (:3000) with hot reload
```

### Production binary

```bash
npm run package      # Creates portable binary at ~/squan-dist/
npm run make         # Creates installers (.exe, .zip, .deb)
```

### Docker images

```bash
docker build -t squan-server ./server
docker build -t squan-client ./client
docker-compose up -d
```

### Binary output

| Platform | Format | Location |
|----------|--------|----------|
| Windows | Squirrel installer | `out/make/squirrel.windows/x64/` |
| Windows | Portable ZIP | `out/make/zip/win32/x64/` |
| macOS | ZIP | `out/make/zip/darwin/x64/` |
| Linux | .deb package | `out/make/deb/x64/` |

---

## Configuration

### Settings (in-app)

| Setting | Where |
|---------|-------|
| Font size | Settings → Appearance |
| Anthropic API key | Settings → Anthropic |
| GitHub token | Settings → GitHub |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `DB_URL` | SQLite database path | `file:./squansq.db` |
| `JWT_SECRET` | Authentication secret | `squansq-dev-secret` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 33 |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS 4 + Lucide icons |
| Backend | Express + TypeScript |
| Database | SQLite (libsql) — cache layer |
| State source of truth | `.squan/` files in git |
| Agent runtime | DirectRunner (Anthropic API) |
| Build | Vite 5 + electron-forge |
| Deployment | Docker + GitHub Actions |

---

## Project Structure

```
squan/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/      # 25+ UI components
│   │   │   ├── AgentChat/   # Goose-style chat with follow-up input
│   │   │   ├── KanbanView/  # Kanban board with Mark Complete
│   │   │   └── Sidebar/     # Project selector + agent list
│   │   ├── hooks/           # WebSocket, real-time state sync
│   │   ├── store/           # Zustand state management
│   │   └── lib/             # Utilities
│   └── Dockerfile
├── server/                  # Express backend
│   └── src/
│       ├── index.ts         # API routes (2000+ lines)
│       ├── squan-fs/        # Everything-as-Code engine
│       ├── workerbee/       # Agent management
│       │   ├── agent-worker.ts   # Child process runner
│       │   ├── process-manager.ts # Process lifecycle
│       │   └── manager.ts        # Agent CRUD + status
│       ├── releasetrain/    # Task/train management
│       └── ws/              # WebSocket server
├── electron/                # Electron main process
├── scripts/                 # Build & packaging scripts
├── docs/                    # Tutorials & documentation
├── .github/workflows/       # CI/CD (deploy + release)
└── docker-compose.yml       # Production deployment
```

---

## API Highlights

| Endpoint | Description |
|----------|-------------|
| `POST /api/release-trains/:id/dispatch` | Create & dispatch an agent for a task |
| `GET /api/workerbees/:id/messages` | Get agent conversation history |
| `POST /api/workerbees/:id/followup` | Send follow-up message to agent |
| `POST /api/workerbees/:id/mark-complete` | Mark agent done & advance kanban |
| `POST /api/release-trains/:id/create-pr` | Create PR from agent's work |
| `WebSocket /ws` | Real-time events (agent status, kanban updates) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘B` / `Ctrl+B` | Toggle sidebar |
| `⌘,` / `Ctrl+,` | Settings |
| `⌘1` | Agents |
| `⌘2` | Kanban |
| `⌘3` | Metrics |
| `⌘4` | Events |
| `⌘5` | Costs |
| `⌘6` | Console |

---

## License

MIT

---

## Author

**Colin Wynd** — [GitHub](https://github.com/tarvitave) · [squan.dev](https://squan.dev)
