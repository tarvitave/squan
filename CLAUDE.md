# Squansq

Browser-based multi-agent orchestration system. Reimplements Gas Town (https://github.com/steveyegge/gastown) in TypeScript with a browser UI instead of tmux.

## Stack

- **server/** — Node.js + TypeScript + Express + WebSocket + node-pty + libsql (SQLite)
- **client/** — React + TypeScript + Vite + xterm.js + Zustand

## Architecture

| Concept | File | Description |
|---------|------|-------------|
| Mayor | server/src/mayor/manager.ts | Orchestrator agent (runs `claude`) |
| Rig | server/src/rig/manager.ts | Project container pointing at a git repo |
| Polecat | server/src/polecat/manager.ts | Worker agent (runs `claude` in rig's repo) |
| Convoy | server/src/convoy/manager.ts | Work tracking bundle |
| Witness | server/src/witness/index.ts | Health monitor — detects zombie polecats |
| PtyManager | server/src/polecat/pty.ts | Spawns + streams pseudo-terminals |
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

## Current priorities

- Improve the polecat spawn flow to create actual git worktrees
- Add a CLAUDE.md injection step when spawning polecats (tell the agent what task to do)
- Add convoy → polecat assignment UI in the browser
- Add Mayor start/stop button to the UI
