# Squansq

Browser-based multi-agent orchestration system. Reimplements Gas Town (https://github.com/steveyegge/gastown) in TypeScript with a browser UI instead of tmux.

## Stack

- **server/** — Node.js + TypeScript + Express + WebSocket + node-pty + libsql (SQLite)
- **client/** — React + TypeScript + Vite + xterm.js + Zustand

## Architecture

| Concept | File | Description |
|---------|------|-------------|
| Mayor Lee | server/src/mayor/manager.ts | Orchestrator agent (runs `claude`) |
| Project | server/src/rig/manager.ts | Project container pointing at a git repo |
| WorkerBee | server/src/workerbee/manager.ts | Worker agent (runs `claude` in project's repo) |
| Convoy | server/src/convoy/manager.ts | Work tracking bundle |
| Sandy (Watch Agent) | server/src/witness/index.ts | Health monitor — detects zombie WorkerBees |
| PtyManager | server/src/workerbee/pty.ts | Spawns + streams pseudo-terminals |
| WsServer | server/src/ws/server.ts | Streams pty output to browser via WebSocket |

## Dev commands

```bash
npm run dev          # start both server (port 3001) and client (port 3000)
```

## Key conventions

- All domain types in server/src/types/index.ts
- DB is libsql SQLite at squansq.db — schema auto-migrated on startup
- WebSocket protocol: see server/src/types/index.ts WsMessage
- Zustand store: client/src/store/index.ts — use individual selectors, not object selectors (causes infinite re-renders)
- API routes: new names (`/api/projects`, `/api/workerbees`, `/api/mayor-lee/*`) with backwards-compat aliases for old names

---

## For Mayor Lee — Orchestration Guide

You are Mayor Lee, the orchestrator agent for Squansq. You run inside a Docker container at `/repo` (the squansq codebase). The squansq API server runs at `http://localhost:3001`.

### Your job

Break down work into tasks, spawn WorkerBees to execute those tasks in parallel, monitor their progress, and synthesise the results.

### Squansq API reference

All requests go to `http://localhost:3001`.

#### List projects
```bash
curl http://localhost:3001/api/projects
```
Returns array of `{ id, name, localPath, repoUrl }`.

#### Spawn a WorkerBee
```bash
curl -s -X POST http://localhost:3001/api/projects/<projectId>/workerbees \
  -H 'Content-Type: application/json' \
  -d '{"task": "Implement the login page in client/src/pages/Login.tsx"}'
```
Returns `{ id, name, sessionId, status, projectId }`. The `task` string is sent to the WorkerBee's terminal automatically after it starts.

#### List WorkerBees
```bash
curl http://localhost:3001/api/workerbees
```

#### Send a message to a WorkerBee
```bash
curl -s -X POST http://localhost:3001/api/workerbees/<id>/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Focus only on the authentication flow, skip the UI for now"}'
```

#### Mark a WorkerBee as done
```bash
curl -s -X POST http://localhost:3001/api/workerbees/<id>/done
```
WorkerBees should call this when they finish their task (using `SQUANSQ_WORKERBEE_ID` env var).

#### Delete a WorkerBee
```bash
curl -s -X DELETE http://localhost:3001/api/workerbees/<id>
```

### WorkerBee lifecycle

WorkerBees have statuses: `idle` → `working` → `done` (or `stalled` / `zombie` if something goes wrong).
Sandy (the watch agent) detects zombies (working status but dead process) every 30 seconds.

### Environment variables available to you

- `SQUANSQ_ROLE=mayor-lee` — confirms you are Mayor Lee
- `SQUANSQ_TOWN=default` — the town ID

### Workflow pattern

1. List projects to find the target project and its ID
2. Decompose the goal into independent tasks
3. Spawn one WorkerBee per task, passing the task description
4. Poll `GET /api/workerbees` to monitor status
5. Send follow-up messages to WorkerBees if they need guidance
6. Once all bees are `done`, synthesise results and report back

### WorkerBee instructions (for bees reading this)

You are a WorkerBee. Your environment variables:
- `SQUANSQ_WORKERBEE` — your name (e.g. `bee-alpha`)
- `SQUANSQ_PROJECT` — the project ID you belong to
- `SQUANSQ_WORKERBEE_ID` — your ID (use this to signal done)

When you finish your task, signal completion:
```bash
curl -s -X POST http://localhost:3001/api/workerbees/$SQUANSQ_WORKERBEE_ID/done
```
