# Squan

**Multi-agent AI development command center.**

Squan orchestrates multiple Claude Code agents working in parallel across your git repositories. Create tasks, dispatch agents, and watch them build — all from a single desktop app.

![Squan](https://img.shields.io/badge/version-0.2.4-teal) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

### 🤖 Multi-Agent Orchestration
- Dispatch multiple Claude Code agents to work on tasks simultaneously
- Each agent works in an isolated git worktree — no conflicts
- Monitor agent progress in real-time via live terminals

### 📋 Kanban Board
- Visual task management with drag-and-drop
- Tasks flow: Open → In Progress → PR Review → Landed
- Auto-updates as agents complete work

### 📁 Everything-as-Code
- All project state stored in `.squan/` directory inside your repo
- Tasks are markdown files with YAML frontmatter
- Every change is a git commit — full audit trail
- `git log .squan/board/` shows your complete task history

### 🖥 Desktop App
- Electron-based — double-click to run (like Goose)
- Embedded server starts automatically
- No terminal, no npm, no Node.js required

### 🔗 GitHub Integration
- Browse and add repos from your GitHub account
- Create new repos directly from Squan
- Auto-clone repos to your workspace

### 📊 Monitoring
- **Events**: Real-time stream of all agent activity
- **Metrics**: Agent success rates, task completion stats
- **Costs**: Token usage and API spend tracking
- **Status Bar**: Live connection, agent count, and cost display

### ⌨ Power User Features
- `sq>` console for CLI-style control
- Command palette (⌘K / Ctrl+K)
- Keyboard shortcuts for all views (⌘1-7)
- tmux backend support for crash-resilient sessions (macOS/Linux)

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

### Option 3: Development mode

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
       ├── SQLite database (cache)
       ├── node-pty / tmux (agent terminals)
       └── Serves React client (static files)

Per-agent:
  └── Git worktree (isolated copy of repo)
       ├── CLAUDE.md (task instructions)
       └── Claude Code CLI (autonomous agent)
```

### How agents work

1. **Dispatch** — Squan creates a git worktree and writes `CLAUDE.md` with the task
2. **Spawn** — A Claude Code process starts in the worktree
3. **Work** — The agent reads the task, writes code, makes commits
4. **Signal** — Agent outputs `DONE:` or `BLOCKED:` when finished
5. **Cleanup** — Worktree is preserved for review, branch ready to merge

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
│   ├── docs/                    # Project documentation
│   └── security/                # Security audit trail
├── src/
└── package.json
```

Every task is a markdown file:

```markdown
---
id: 85be0feb
title: Add OAuth2 authentication
status: open
type: ai
priority: high
tags: [auth, security]
---

## Description
Implement OAuth2 with Google and GitHub providers.

## Acceptance Criteria
- [ ] Google OAuth login works
- [ ] GitHub OAuth login works
- [ ] Tokens stored securely
```

---

## Tutorials

- **[Tutorial 1: Using Squan via the UI](docs/tutorial-01-ui.md)** — Step-by-step walkthrough creating a Stock Price Dashboard project using the graphical interface
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

### Binary output

| Platform | Format | Location |
|----------|--------|----------|
| Windows | Squirrel installer | `out/make/squirrel.windows/x64/` |
| Windows | Portable ZIP | `out/make/zip/win32/x64/` |
| macOS | ZIP | `out/make/zip/darwin/x64/` |
| Linux | .deb package | `out/make/deb/x64/` |
| All | Portable folder | `~/squan-dist/Squan-{platform}-{arch}/` |

---

## Configuration

### Settings (in-app)

| Setting | Where |
|---------|-------|
| Font size | Settings → Appearance |
| Anthropic API key | Settings → Anthropic |
| GitHub token | Settings → GitHub |
| Terminal backend | Settings → Terminal Backend |

### Terminal backends

| Backend | Platform | Crash resilient | Description |
|---------|----------|-----------------|-------------|
| **node-pty** (default) | All | No | In-process terminals, fast |
| **tmux** | macOS/Linux | Yes | Agents survive server restarts |

Switch in Settings → Terminal Backend.

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
| Agent runtime | Claude Code CLI + node-pty |
| Build | Vite 5 + electron-forge |

---

## Project Structure

```
squan/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/      # 25+ UI components
│   │   ├── store/           # Zustand state management
│   │   └── lib/             # Utilities
│   └── vite.config.ts
├── server/                  # Express backend
│   └── src/
│       ├── index.ts         # API routes (1600+ lines)
│       ├── squan-fs/        # Everything-as-Code engine
│       ├── workerbee/       # Agent management + PTY
│       ├── releasetrain/    # Task/train management
│       ├── mayor/           # Root agent orchestrator
│       └── ws/              # WebSocket server
├── electron/                # Electron main process
│   └── src/
│       ├── main.ts          # Window, tray, server lifecycle
│       └── preload.ts       # IPC bridge
├── scripts/                 # Build & packaging scripts
├── docs/                    # Tutorials & documentation
└── forge.config.ts          # Electron-forge config
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘B` / `Ctrl+B` | Toggle sidebar |
| `⌘,` / `Ctrl+,` | Settings |
| `⌘1` | Terminals |
| `⌘2` | Kanban |
| `⌘3` | Metrics |
| `⌘4` | Events |
| `⌘5` | Costs |
| `⌘6` | Console |
| `⌘7` | Claude Code |

---

## License

MIT

---

## Author

Colin
