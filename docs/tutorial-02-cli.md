# Tutorial 2: Using Squan via the Console & CLI

This tutorial builds the same **Stock Price Dashboard** project entirely from Squan's console (`sq>`) — no clicking, all commands. This is the power-user workflow.

---

## Prerequisites

Same as Tutorial 1:
- Node.js 18+, Git, Claude Code CLI, Anthropic API key
- Squan running (`npm start` or `npm run dev`)
- Signed in to Squan

---

## Step 1: Open the Squan Console

In the Squan UI, click **Console** in the sidebar. You see the `sq>` prompt.

Type `help` to see all available commands:

```
sq> help

sq — Squan console

Overview
  status               Full orchestration overview
  agents               List all agents
  projects             List all projects
  trains [status]      List release trains

Agents
  spawn <proj> <task>  Spawn an agent
  kill <name>          Kill an agent
  restart <name>       Restart a zombie/stalled agent
  send <name> <msg>    Send a message to an agent

Release Trains
  create-train <p> <n> Create a release train
  dispatch <id>        Dispatch a release train
  land <id>            Mark a release train complete

Atomic Tasks
  tasks [rt-id]        List tasks
  task <rt-id> <title> Create a task
  done <task-id>       Mark a task done
```

---

## Step 2: Set up the project

First, create the git repo (do this in a **separate terminal**, not the sq console):

```bash
mkdir C:\Users\colin\Projects\stock-dashboard
cd C:\Users\colin\Projects\stock-dashboard
git init
echo "# Stock Price Dashboard" > README.md
git add . && git commit -m "Initial commit"
```

Now register it in Squan. Back in the `sq>` console:

```
sq> projects
(no projects)
```

The console's `projects` command lists registered projects. To add one, use the Terminals view to call the API, or add it through the project dropdown in the sidebar. Once added:

```
sq> projects
stock-dashboard
  id:   4b23fa02
  path: C:\Users\colin\Projects\stock-dashboard
  repo: —
```

---

## Step 3: Check orchestration status

```
sq> status

── Projects ──
stock-dashboard  4b23fa02

── Agents ──
(none)

── Release Trains ──
(none)
```

Clean slate. Let's build this project.

---

## Step 4: Create release trains (task groups)

In Squan, a **release train** is a task with instructions that an agent will execute. Create the first one:

```
sq> create-train stock-dashboard "Set up React + Vite project"
✓ Created  Set up React + Vite project  4f8a2c1b
```

The train is now in "open" status. Check:

```
sq> trains
ID        STATUS         NAME
4f8a2c1b  open           Set up React + Vite project
```

Create the rest:

```
sq> create-train stock-dashboard "Build stock price API service"
✓ Created  Build stock price API service  7e3d9b2a

sq> create-train stock-dashboard "Create interactive chart component"
✓ Created  Create interactive chart component  a1c5f8d3

sq> create-train stock-dashboard "Build dashboard layout with watchlist"
✓ Created  Build dashboard layout with watchlist  b2d6e9f4
```

Now check all trains:

```
sq> trains
ID        STATUS         NAME
4f8a2c1b  open           Set up React + Vite project
7e3d9b2a  open           Build stock price API service
a1c5f8d3  open           Create interactive chart component
b2d6e9f4  open           Build dashboard layout with watchlist
```

---

## Step 5: Add detailed instructions

Each release train has a description that becomes the agent's `CLAUDE.md` — its task instructions. Let's add details.

Click on a train in the **Kanban** view to edit its description, or use the UI's release train panel. The description should be the full agent instructions:

For **"Set up React + Vite project"**, the description should be:
```
Initialize a React + TypeScript + Vite project. Install dependencies:
- recharts for charts
- axios for API calls  
- tailwindcss for styling

Create a basic App.tsx that renders "Stock Price Dashboard" as a heading.
Set up the project structure:
- src/components/
- src/services/
- src/hooks/
- src/types/

Ensure `npm run dev` starts the dev server successfully.
```

---

## Step 6: Dispatch agents

Now the fun part — spin up agents to work on these tasks:

```
sq> dispatch 4f8a2c1b
✓ Dispatched  bee-alpha  branch: workerbee/bee-alpha-1712345
```

What just happened:
1. Squan created a **git worktree** at `.squansq-worktrees/stock-dashboard/bee-alpha-{timestamp}/`
2. Wrote `CLAUDE.md` with the task description
3. Spawned a **Claude Code** process in that worktree
4. The agent read CLAUDE.md and started working

Watch it:

```
sq> agents
NAME                STATUS        TASK
bee-alpha           working       Set up React + Vite project
```

Dispatch the second task in parallel:

```
sq> dispatch 7e3d9b2a
✓ Dispatched  bee-bravo  branch: workerbee/bee-bravo-1712346
```

Now two agents are working simultaneously:

```
sq> agents
NAME                STATUS        TASK
bee-alpha           working       Initialize React + Vite project
bee-bravo           working       Build stock price API service
```

Dispatch all of them:

```
sq> dispatch a1c5f8d3
✓ Dispatched  bee-charlie  branch: workerbee/bee-charlie-1712347

sq> dispatch b2d6e9f4
✓ Dispatched  bee-delta  branch: workerbee/bee-delta-1712348
```

Four agents working in parallel! Check the full status:

```
sq> status

── Projects ──
stock-dashboard  4b23fa02

── Agents ──
bee-alpha            ● working   Set up React + Vite project
bee-bravo            ● working   Build stock price API service
bee-charlie          ● working   Create interactive chart component
bee-delta            ● working   Build dashboard layout with watchlist

── Release Trains ──
Set up React + Vite project          in_progress → bee-alpha   (0/0 tasks)
Build stock price API service        in_progress → bee-bravo   (0/0 tasks)
Create interactive chart component   in_progress → bee-charlie (0/0 tasks)
Build dashboard layout with watchlist in_progress → bee-delta  (0/0 tasks)
```

---

## Step 7: Monitor agents

### Check individual agent status

```
sq> train 4f8a2c1b

Set up React + Vite project  ● in_progress
id: 4f8a2c1b
agent: bee-alpha  ● working
```

### Send a message to a running agent

Need to give an agent extra context? Send it a message directly:

```
sq> send bee-bravo "Make sure to add TypeScript types for all API responses. Use interfaces, not type aliases."
✓ Sent
```

This types the message directly into the agent's Claude Code terminal.

### Spawn a one-off agent (no release train)

Need a quick task done without creating a release train?

```
sq> spawn stock-dashboard "Add a .gitignore file with node_modules, dist, .env, and .DS_Store entries"
✓ Spawned  bee-echo  branch: workerbee/bee-echo-1712349
```

---

## Step 8: Handle problems

### Agent finished successfully

When an agent outputs `DONE:`, Squan detects it:

```
sq> agents
NAME                STATUS        TASK
bee-alpha           ✓ done        Set up React + Vite project — Project initialized with all dependencies
bee-bravo           ● working     Build stock price API service
bee-charlie         ● working     Create interactive chart component
bee-delta           ◐ stalled     Build dashboard layout with watchlist
bee-echo            ✓ done        Add .gitignore
```

### Agent is stalled

bee-delta is stalled. Check what happened:

```
sq> train b2d6e9f4

Build dashboard layout with watchlist  ◐ stalled
id: b2d6e9f4
agent: bee-delta  ◐ stalled
note: BLOCKED: Cannot find StockChart component — it doesn't exist yet. Need the chart component to be built first.
```

The agent needs the chart component that bee-charlie is still building. Options:

**Option A: Wait and restart**

```
sq> restart bee-delta
✓ Restarted  bee-delta
```

This kills the old session and starts a fresh one. The agent re-reads CLAUDE.md and tries again.

**Option B: Send a hint**

```
sq> send bee-delta "The StockChart component is being built by another agent. For now, create a placeholder component that returns a <div>Loading chart...</div> and continue with the rest of the layout. The real component will be integrated later."
✓ Sent
```

**Option C: Kill and re-dispatch later**

```
sq> kill bee-delta
✓ Killed bee-delta

# Wait for bee-charlie to finish, then re-dispatch
sq> dispatch b2d6e9f4
✓ Dispatched  bee-foxtrot  branch: workerbee/bee-foxtrot-1712350
```

### Agent became a zombie

If an agent crashes (Claude Code exits unexpectedly):

```
sq> agents
NAME                STATUS        TASK
bee-charlie         ✕ zombie      Create interactive chart component
```

Kill it and re-dispatch:

```
sq> kill bee-charlie
✓ Killed bee-charlie

sq> dispatch a1c5f8d3
✓ Dispatched  bee-golf  branch: workerbee/bee-golf-1712351
```

---

## Step 9: Land completed trains

When all agents finish:

```
sq> status

── Agents ──
bee-alpha            ✓ done       Set up React + Vite project
bee-bravo            ✓ done       Build stock price API service
bee-golf             ✓ done       Create interactive chart component
bee-foxtrot          ✓ done       Build dashboard layout with watchlist
bee-echo             ✓ done       Add .gitignore

── Release Trains ──
Set up React + Vite project          landed
Build stock price API service        landed
Create interactive chart component   landed
Build dashboard layout with watchlist landed
```

Trains auto-land when their agent completes. You can also manually land:

```
sq> land b2d6e9f4
✓ Landed
```

---

## Step 10: View the results

### Check git history

In your **separate terminal**:

```bash
cd C:\Users\colin\Projects\stock-dashboard
git log --oneline --all --graph
```

You'll see branches from each agent with their commits.

### Merge agent branches

Each agent worked on its own branch. Merge them:

```bash
git merge workerbee/bee-alpha-1712345
git merge workerbee/bee-bravo-1712346
git merge workerbee/bee-golf-1712351
git merge workerbee/bee-foxtrot-1712350
```

### Run the app

```bash
npm install
npm run dev
```

Open `http://localhost:5173` — your Stock Price Dashboard is running.

---

## Command Quick Reference

### Information

| Command | Description |
|---------|-------------|
| `status` | Full overview — projects, agents, trains |
| `agents` | List all agents with status |
| `projects` | List all registered projects |
| `trains [status]` | List release trains (optionally filter by status) |
| `train <id>` | Detail view of a specific release train |
| `tasks [rt-id]` | List atomic tasks |

### Agent Control

| Command | Description |
|---------|-------------|
| `spawn <project> "<task>"` | Spawn a one-off agent |
| `kill <name>` | Kill an agent |
| `restart <name>` | Kill and restart an agent |
| `send <name> "<message>"` | Send a message to a running agent's terminal |

### Release Train Management

| Command | Description |
|---------|-------------|
| `create-train <project> "<name>"` | Create a new release train |
| `dispatch <train-id>` | Assign an agent and start work |
| `land <train-id>` | Mark a release train as complete |

### Atomic Tasks

| Command | Description |
|---------|-------------|
| `task <train-id> "<title>"` | Add a sub-task to a release train |
| `done <task-id>` | Mark a sub-task as done |

---

## Tips

1. **Dispatch in dependency order** — If Task B depends on Task A's output, dispatch A first, wait for it to complete, then dispatch B.

2. **Use `send` liberally** — If you see an agent going in the wrong direction, send it a correction. It's like talking to a colleague.

3. **Name your trains well** — The train name becomes part of the agent's context. "Fix login bug" is better than "Task 7".

4. **Check `.squan/board/`** — Your task history is in git. `git log .squan/board/` shows every task change ever made.

5. **Multiple projects** — Squan can manage agents across multiple repos simultaneously. Each project gets its own set of agents and trains.
