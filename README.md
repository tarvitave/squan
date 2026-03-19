# Squansq

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue?logo=docker)](https://ghcr.io/tarvitave/squansq-server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react)](https://react.dev/)

**The command center for AI-powered software development across multiple projects.**

---

## Why SquansQ?

Building software today means juggling dozens of moving pieces — feature branches, bug fixes, documentation, design tasks, code reviews, and deployments — often across multiple repositories at once. Most tools force you to context-switch constantly: open a terminal here, check a Jira board there, wait for one thing before starting the next.

Squansq changes that entirely.

It gives you a **single unified interface** where you can spin up multiple AI coding agents (powered by Claude Code), each working independently in their own isolated environment, while you stay in control of the bigger picture. You direct the work at a high level. The agents execute. You watch it happen in real time.

### What makes it different

**You can work on multiple projects simultaneously.** Register as many git repositories as you want. Each project gets its own pool of agents. Agents work in isolated git worktrees — they never step on each other, and their branches never conflict. Ten agents can commit to the same repository at the same time with zero friction.

**Coding and non-coding tasks live in the same place.** Software delivery isn't just code. It's planning, coordination, tracking, review, and communication. Squansq's kanban board tracks all your work — atomic tasks, release trains, agent status — so you always know what's in progress, what's blocked, and what's done. No separate project management tool required.

**You stay in control without being in the weeds.** The Root Agent acts as your orchestrator. Give it a high-level goal — "add authentication to the API" — and it breaks the work into release trains, creates atomic tasks, and dispatches specialized agents to each work stream. Meanwhile, you monitor progress through live terminals, the kanban board, or the `sq` CLI, and step in only when needed.

**Everything is live.** The dashboard updates in real time over WebSockets. You see agent output as it happens, token costs as they accrue, events as they fire. When an agent commits code, a post-commit hook pings the Root Agent immediately — no polling, no delays.

**It meets you where you are.** Use the browser dashboard for visual oversight. Drop into the `sq` CLI when you want speed. Open a Console pane alongside your terminals to run commands without switching context. Watch your Claude Code sessions replay in the Claude Code viewer.

This is what it looks like to bring an application to life with AI — not one agent in one chat window, but a coordinated team of agents working in parallel, tracked and managed from a single pane of glass.

---

## Features at a Glance

- **Multi-agent orchestration** — parallel Claude Code agents, each in an isolated git worktree on its own branch
- **Root Agent coordination** — an orchestrator with MCP tools to plan, dispatch, and monitor the full agent fleet
- **Release Trains & Atomic Tasks** — structured work breakdown from feature area down to individual deliverable
- **Native Kanban board** — visualize all tasks and agents in one board without leaving the app
- **Live terminals** — xterm.js terminals with split layouts (single, split-h, split-v, quad) in named tabs
- **Real-time dashboard** — WebSocket-powered updates, event stream, cost/token tracking, metrics panel
- **`sq` CLI** — full command-line control of agents, trains, tasks, and projects
- **Browser Console** — run `sq` commands directly in the dashboard alongside your terminals
- **Claude Code viewer** — browse `~/.claude/projects/` conversations with live real-time hook events
- **Multi-project support** — register multiple git repos and dispatch agents across all of them
- **PR creation** — push branches and open GitHub pull requests from the UI
- **Isolated agent environments** — per-agent config dirs, CLAUDE.md injection, post-commit hook propulsion

---

## Table of Contents

- [Architecture](#architecture)
- [Key Concepts](#key-concepts)
- [Installation](#installation)
  - [Local Development](#local-development)
  - [Docker](#docker)
  - [Docker Compose](#docker-compose)
  - [sq CLI Setup](#sq-cli-setup)
- [Usage](#usage)
  - [Quick Start](#quick-start)
  - [Working with Agents](#working-with-agents)
  - [Working with Release Trains](#working-with-release-trains)
  - [Claude Code Integration](#claude-code-integration)
  - [Tab and Pane System](#tab-and-pane-system)
- [The `sq` CLI](#the-sq-cli)
- [Root Agent Workflow](#root-agent-workflow)
- [Agent Isolation](#agent-isolation)
- [MCP Tools Reference](#mcp-tools-reference)
- [Environment Variables](#environment-variables)
- [Agent Status Reference](#agent-status-reference)
- [License](#license)

---

## Architecture

```
squansq/
├── server/          # Express + WebSocket server (Node.js/TypeScript)
│   └── src/
│       ├── index.ts          # Main server entry point and API routes
│       ├── workerbee/        # Agent spawning and PTY management
│       ├── mayor/            # Root agent management
│       ├── mcp/              # MCP server (JSON-RPC 2.0 over HTTP)
│       ├── claudecode/       # Claude Code JSONL reader + hook receiver
│       ├── ws/               # WebSocket broadcast server
│       └── db/               # SQLite database (libsql)
├── client/          # React frontend (Vite + TypeScript)
│   └── src/
│       ├── App.tsx
│       ├── store/            # Zustand state management
│       ├── components/
│       │   ├── AgentTree/        # Sidebar agent list
│       │   ├── ClaudeCodePanel/  # Claude Code session viewer
│       │   ├── ConsolePanel/     # Browser sq console
│       │   ├── KanbanView/       # Kanban board
│       │   ├── MayorPanel/       # Root agent controls
│       │   ├── MetricsPanel/     # Token/cost metrics
│       │   ├── PaneGrid/         # Terminal/console pane grid
│       │   ├── TabBar/           # Tab bar with rename support
│       │   └── TerminalPane/     # xterm.js terminal
│       └── hooks/
│           └── useWebSocket.ts
└── scripts/
    └── sq.mjs       # sq CLI tool
```

**Stack:**

| Layer | Technology |
|-------|-----------|
| Server | Node.js, Express, TypeScript |
| Database | SQLite via libsql |
| Real-time | WebSockets |
| Client | React, Vite, Zustand |
| Terminals | xterm.js |
| Agents | Claude Code CLI (PTY processes) |
| Orchestration | HTTP JSON-RPC 2.0 MCP server |

---

## Key Concepts

### Root Agent

The orchestrator — a Claude Code instance with access to all MCP tools. You give it a high-level goal. It calls `get_status_summary` to understand the current state, breaks the work into Release Trains and Atomic Tasks, and dispatches specialized agents to each work stream. It monitors progress via post-commit hooks and re-dispatches stalled agents automatically. Its terminal is always accessible from the left sidebar.

### WorkerBee

A Claude Code agent working on a specific task. Each WorkerBee:

- Lives in its own git worktree on an isolated branch
- Receives a `CLAUDE.md` injected with its task description
- Runs as a PTY process managed by the server
- Reports progress back to the Root Agent via git post-commit hooks

Agents progress through states: `idle` → `working` → `stalled` → `zombie` → `done`

### Release Train

A unit of work corresponding to a feature area or work stream. Has a name, description, and status (`open`, `in_progress`, `landed`, `cancelled`). The Root Agent creates Release Trains, then dispatches a WorkerBee to each one. The Release Train description becomes that WorkerBee's `CLAUDE.md` — the full briefing it receives before starting work.

### Atomic Task

A granular, discrete deliverable within a Release Train (e.g., "implement `/login` endpoint", "add refresh token rotation", "write integration tests"). Atomic Tasks have a status (`open`, `in_progress`, `done`, `blocked`) and are updated as work progresses. They power the Kanban board.

### Project 

A git repository registered with Squansq. Each Project has a filesystem path, an optional remote repo URL, and an optional runtime command. Agents create worktrees off the Project root.

---

## Installation

### Prerequisites

- Node.js 20+
- Claude Code CLI installed and authenticated
- Anthropic API key

### Local Development

```bash
git clone https://github.com/tarvitave/squansq
cd squansq
npm install
cp server/.env.example server/.env
# Edit server/.env — set PORT, JWT_SECRET, ANTHROPIC_API_KEY
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Docker

```bash
docker pull ghcr.io/tarvitave/squansq-server:latest

docker run -d \
  -p 3001:3001 \
  -v ~/.claude:/root/.claude \
  -v /path/to/repos:/repos \
  -e JWT_SECRET=your-secret \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  --name squansq \
  ghcr.io/tarvitave/squansq-server:latest
```

The server serves the built client at [http://localhost:3001](http://localhost:3001).

### Docker Compose

```yaml
version: '3.8'
services:
  server:
    image: ghcr.io/tarvitave/squansq-server:latest
    restart: unless-stopped
    environment:
      PORT: "3001"
      DB_URL: "file:/data/squansq.db"
      SQUANSQ_REPO_PATH: "/repo"
      JWT_SECRET: "change-me-in-production"
      ANTHROPIC_API_KEY: "sk-ant-..."
      # GITHUB_TOKEN: "ghp_..."  # optional, for PR creation
    volumes:
      - db_data:/data
      - claude_auth:/root/.claude
      - /opt/squansq-repo:/repo
    cap_add:
      - SYS_PTRACE
    devices:
      - /dev/ptmx:/dev/ptmx

  client:
    image: ghcr.io/tarvitave/squansq-client:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - server

volumes:
  db_data:
  claude_auth:
```

```bash
docker compose up -d
```

### `sq` CLI Setup

```bash
# Install globally from the repo root
npm install -g .

# Or run directly without installing
node scripts/sq.mjs login

# Authenticate with your server
sq login
# Enter: http://localhost:3001
# Enter: your-jwt-token
```

Alternatively, set environment variables:

```bash
export SQUANSQ_URL=http://localhost:3001
export SQUANSQ_TOKEN=your-jwt-token
```

---

## Usage

### Quick Start

1. Add a project (git repo) in the **Projects** panel in the left sidebar
2. Open the **Root Agent** panel and give it a high-level task
3. The Root Agent plans, creates Release Trains and Atomic Tasks, and dispatches WorkerBees
4. Watch agents work in live terminals in the **Terminals** view
5. Monitor overall progress in the **Kanban** view or with `sq status`
6. When agents complete their trains, the Root Agent lands them and summarizes

### Working with Agents

```bash
# See everything at a glance — agents, trains, tasks
sq status

# Spawn an agent directly with a task
sq spawn <project-id> "Implement the user auth feature"

# Send a message to a running agent
sq send bee-alpha "Focus on the login endpoint first"

# Kill a stalled agent
sq kill bee-alpha

# Kill and respawn with the same task
sq restart bee-alpha
```

### Working with Release Trains

```bash
# Create a release train
sq create-train "Auth feature" "Implement JWT auth with refresh tokens"

# Dispatch it to an agent
sq dispatch <train-id>

# Check its status and atomic tasks
sq train <train-id>

# Mark a task done
sq done <task-id> "Endpoint tested and passing"

# Land the train when all work is complete
sq land <train-id>
```

### Claude Code Integration

The **Claude Code** view in the dashboard reads your existing `~/.claude/projects/` JSONL conversation files and renders user/assistant messages, tool use blocks, and thinking blocks exactly as they occurred.

1. Click the **Claude Code** view in the dashboard
2. Select a session from the dropdown (auto-sorted by most recent)
3. Click **"⚡ enable live hooks"** to receive real-time tool-use events as they happen
4. The panel polls for new messages every 2 seconds with an incremental cursor

Hook configuration is written automatically to `~/.claude/settings.local.json`. Events arrive via `POST /api/claude-code/hook` and stream into the sidebar in real time.

### Tab and Pane System

| Layout | Description |
|--------|-------------|
| `single` | One full-screen pane |
| `split-h` | Two panes side by side |
| `split-v` | Two panes top and bottom |
| `quad` | 2×2 grid of four panes |

Each pane can be a **terminal** (live xterm.js connected to an agent) or a **console** (interactive `sq` command panel). Mix and match freely within a tab.

**Tab management:**
- Click `+` to create a new tab — you'll be prompted for a name
- Double-click a tab label to rename it inline
- Multiple console panes can be open simultaneously alongside terminal panes

---

## The `sq` CLI

Run with `sq <command>` after global install, or `node scripts/sq.mjs <command>` directly.

IDs accept full UUIDs, 8-character prefixes, or agent names like `bee-alpha`.

| Command | Description |
|---------|-------------|
| `sq login` | Save server URL and token to `~/.squansq` |
| `sq status` | Full overview: agents, trains, and tasks |
| `sq agents` | List all WorkerBees and their status |
| `sq projects` | List all registered projects (git repos) |
| `sq trains` | List all release trains |
| `sq train <id>` | Show release train details with atomic tasks |
| `sq dispatch <train-id> [project-id]` | Spawn an agent for a release train |
| `sq kill <agent-id>` | Kill an agent |
| `sq restart <agent-id>` | Kill and respawn with the same task |
| `sq spawn <project-id> "<task>"` | Spawn an agent with a task description |
| `sq create-train "<name>" "<desc>" [project-id]` | Create a release train |
| `sq land <train-id>` | Mark a release train as complete |
| `sq tasks [train-id]` | List atomic tasks, optionally filtered by train |
| `sq task <id>` | Show task details |
| `sq done <task-id> [note]` | Mark an atomic task as done |
| `sq send <agent-id> "<message>"` | Send a message to a running agent |
| `sq help` | Show all commands |

The same commands are available in the **Console** panel inside the browser dashboard.

---

## Root Agent Workflow

The Root Agent follows a structured five-step workflow for every task:

### Step 1 — Orient

Call `get_status_summary` to understand the current state of all agents, trains, and tasks. Call `list_projects` to get available project IDs.

### Step 2 — Plan

Break work into Release Trains (feature areas) and Atomic Tasks (discrete steps):

```
create_release_train → "Auth Refactor"
  create_atomic_task → "Design token schema"
  create_atomic_task → "Implement /login endpoint"
  create_atomic_task → "Add refresh token rotation"
  create_atomic_task → "Write integration tests"

create_release_train → "Email Notifications"
  create_atomic_task → "Set up nodemailer"
  create_atomic_task → "Write email templates"
  create_atomic_task → "Add queue for retry logic"
```

### Step 3 — Dispatch

Dispatch independent Release Trains in parallel — each gets its own WorkerBee:

```
dispatch_release_train(train_id_1)  →  spawns bee-alpha
dispatch_release_train(train_id_2)  →  spawns bee-bravo
```

The Release Train description becomes that WorkerBee's `CLAUDE.md` — its complete briefing.

### Step 4 — Monitor

As agents commit code, post-commit hooks notify the Root Agent immediately. It calls `update_atomic_task` to mark tasks done, checks for stalled or zombie agents, and re-dispatches as needed.

### Step 5 — Complete

When all Atomic Tasks for a train are done:

```
land_release_train(train_id)
```

The Root Agent summarizes what was accomplished once all trains are landed.

---

## Agent Isolation

Every WorkerBee is fully isolated from all others:

| Mechanism | Detail |
|-----------|--------|
| Git worktree | Each agent checks out its own worktree at a unique path — never sharing the working tree |
| Git branch | A dedicated branch is created per worktree so commits never collide |
| `CLAUDE_CONFIG_DIR` | Each agent gets its own Claude config directory, isolating sessions, history, and settings |
| `CLAUDE.md` injection | The Release Train description is written into `CLAUDE.md` at the worktree root — the agent's full briefing |
| Post-commit hook | A `git post-commit` hook in each worktree pings the Root Agent after every commit |

Ten agents can commit to the same repository simultaneously with zero conflicts.

---

## MCP Tools Reference

The Root Agent coordinates via the Squansq MCP server (HTTP JSON-RPC 2.0 at `/api/mcp`):

| Tool | Description |
|------|-------------|
| `get_status_summary` | Full overview: agents with tasks/status, trains with atomic tasks |
| `list_workerbees` | List all agents and their current status |
| `spawn_workerbee` | Spawn a new agent with a task description |
| `get_workerbee` | Get details on a specific agent |
| `kill_workerbee` | Stop and remove an agent |
| `list_projects` | List registered git repos |
| `list_release_trains` | List all work bundles |
| `create_release_train` | Create a new release train |
| `get_release_train` | Get a train and all its atomic tasks |
| `dispatch_release_train` | Spawn an agent and assign it to a train |
| `land_release_train` | Mark a release train as complete |
| `list_atomic_tasks` | List atomic tasks (filterable by train) |
| `create_atomic_task` | Create a task and link it to a train |
| `update_atomic_task` | Update task status (`open` / `in_progress` / `done` / `blocked`) |
| `update_release_train` | Update a train's description or status |
| `list_hooks` | List persistent work units (hooks) |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port the server listens on |
| `DB_URL` | `file:./squansq.db` | SQLite database path |
| `SQUANSQ_REPO_PATH` | _(required)_ | Filesystem path for git worktrees |
| `JWT_SECRET` | _(required)_ | Secret used to sign authentication JWTs |
| `ANTHROPIC_API_KEY` | _(optional)_ | Anthropic API key — can be set here or per-user in the UI |
| `GITHUB_TOKEN` | _(optional)_ | GitHub personal access token for PR creation (`repo` scope) |
| `MAYOR_COMMAND` | `claude` | Command used to launch the Root Agent |

---

## Agent Status Reference

| Status | Meaning |
|--------|---------|
| `idle` | Agent just spawned, not yet active |
| `working` | Agent is actively running and producing output |
| `done` | Agent has completed its task |
| `stalled` | Agent has produced no output for an extended period |
| `zombie` | Agent process has crashed or exited unexpectedly |

Stalled and zombie agents can be restarted with `sq restart <name>` or via the Agents panel in the sidebar.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with Claude Code &middot; <a href="https://squansq.com">squansq.com</a>
</p>
