# Tutorial 1: Using Squan via the UI

This tutorial walks you through launching Squan, creating a project called **Stock Price Dashboard**, setting up tasks on the kanban board, and dispatching AI agents to build it — all through the graphical interface.

---

## Prerequisites

- **Node.js 18+** installed
- **Git** installed and configured
- **Claude Code CLI** installed (`npm install -g @anthropic-ai/claude-code`)
- **Anthropic API key** (for agent billing)
- A directory where you want to create the project (e.g. `C:\Users\colin\Projects\`)

---

## Step 1: Start Squan

Open a terminal and run:

```bash
cd C:\Users\colin\Projects\squansq
npm start
```

This does three things:
1. Builds the server (Express + SQLite + WebSocket)
2. Builds the client (React + Tailwind)
3. Launches the Electron app with the embedded server

The Squan window opens automatically. You should see the **login page** with a green "Server connected" indicator.

> **Alternative**: If you prefer the browser, run `npm run dev` and open `http://localhost:3000`.

---

## Step 2: Create an account

1. Click the **Register** tab
2. Enter your email and a password
3. Paste your **Anthropic API key** (starts with `sk-ant-api03-...`)
4. Click **Create account**

You're now signed in. The main Squan interface appears with a sidebar on the left.

---

## Step 3: Create the project

The Stock Price Dashboard needs a git repository. Open a **separate terminal** and create it:

```bash
mkdir C:\Users\colin\Projects\stock-dashboard
cd C:\Users\colin\Projects\stock-dashboard
git init
echo "# Stock Price Dashboard" > README.md
git add . && git commit -m "Initial commit"
```

Now add it to Squan:

1. In the Squan sidebar, click the **project dropdown** at the top (shows "All Projects")
2. Click **Add project…** at the bottom of the dropdown
3. This switches you to the **Terminals** view

You need to register the project via the console. Click the **Console** view in the sidebar, then type:

```
sq> create-project stock-dashboard "C:\Users\colin\Projects\stock-dashboard"
```

Or use the **Terminals** view:
1. Click **+ Terminal** to open a new terminal
2. The terminal opens in the project directory

Back in the sidebar, click the project dropdown — **stock-dashboard** now appears. Select it.

---

## Step 4: Initialize .squan/ (Everything-as-Code)

With the stock-dashboard project selected, open the **Console** and run:

```
sq> init-squan
```

This creates the `.squan/` directory in your project with:
```
stock-dashboard/
├── .squan/
│   ├── config.yaml          ← Project settings
│   ├── board/               ← Kanban board
│   │   ├── open/
│   │   ├── in_progress/
│   │   ├── pr_review/
│   │   ├── landed/
│   │   └── cancelled/
│   ├── charters/            ← Agent knowledge
│   ├── templates/           ← Reusable tasks
│   ├── docs/                ← Documentation
│   └── security/            ← Security reviews
├── README.md
```

Everything is committed to git automatically.

---

## Step 5: Create tasks on the Kanban board

Click **Kanban** in the sidebar. You see an empty board with columns: Open, In Progress, PR Review, Landed, Cancelled.

### Create your first task

1. Click the **+** button in the "Open" column header
2. Fill in:
   - **Task name**: `Set up React + Vite project`
   - **Agent instructions**: `Initialize a React + TypeScript + Vite project. Install dependencies: recharts for charts, axios for API calls, and tailwindcss for styling. Create a basic App.tsx that renders "Stock Price Dashboard".`
   - Leave **AI task** selected (not Manual)
   - Check **Auto-dispatch agent** ✓
3. Click **Create & Dispatch**

What happens:
- A task file is created at `.squan/board/open/abc123-set-up-react-vite-project.md`
- A git commit is made: `squan: create task "Set up React + Vite project"`
- An agent (**bee-alpha**) is spawned in a git worktree
- The agent's terminal appears in the Terminals view
- The task card moves to **In Progress** on the board

### Watch the agent work

1. Click **Terminals** in the sidebar
2. You see bee-alpha's terminal tab — Claude Code is running
3. Watch as it creates files, installs dependencies, makes commits

### Create more tasks

Go back to **Kanban** and create these tasks (you can create them all at once — they'll queue):

**Task 2**: `Build stock price API integration`
```
Create a service module (src/services/stockApi.ts) that fetches stock prices from the Alpha Vantage API. 
Support: daily time series, intraday (5min), and quote endpoint.
Use axios. Handle errors gracefully. Add TypeScript types for all responses.
Use environment variable VITE_ALPHA_VANTAGE_KEY for the API key.
```

**Task 3**: `Create interactive stock chart component`
```
Build a React component (src/components/StockChart.tsx) using recharts.
Features:
- Line chart showing closing prices over time
- Tooltip showing date, open, high, low, close, volume
- Date range selector (1W, 1M, 3M, 6M, 1Y)
- Loading skeleton while data fetches
- Responsive layout
```

**Task 4**: `Build dashboard layout with watchlist`
```
Create the main dashboard layout:
- Header with app title and search bar
- Watchlist sidebar (add/remove stocks, show current price + change %)
- Main area shows the selected stock's chart
- Store watchlist in localStorage
- Default watchlist: AAPL, GOOGL, MSFT, TSLA
```

**Task 5** (Manual): `Get Alpha Vantage API key`
```
Sign up at alphavantage.co for a free API key.
Add it to .env as VITE_ALPHA_VANTAGE_KEY=your_key_here
```

For Task 5, select **Manual** instead of AI task. This is a human task — you'll do it yourself.

---

## Step 6: Monitor progress

### The Kanban board

As agents work, task cards move across the board automatically:
- **Open** → **In Progress** (when an agent is dispatched)
- **In Progress** → **Landed** (when the agent outputs `DONE:`)
- Cards show the assigned agent name and a status indicator (● working, ✓ done)

### The Events view

Click **Events** in the sidebar to see a real-time stream:
```
14:23:01  workerbee.spawned    bee-alpha
14:23:05  workerbee.working    bee-alpha  
14:25:31  workerbee.done       bee-alpha — Set up React + Vite project complete
14:25:32  releasetrain.landed  Set up React + Vite project
14:25:33  workerbee.spawned    bee-bravo
14:25:37  workerbee.working    bee-bravo
```

### The Metrics view

Click **Metrics** to see aggregate stats:
- Total agents, working, done, stalled, zombie
- Tasks by status
- Success rate
- Progress bars

### The Costs view

Click **Costs** to monitor API spend:
- Total tokens used
- Cost per agent
- Daily breakdown
- Link to Anthropic Console for exact billing

---

## Step 7: Handle a stalled agent

Sometimes an agent gets stuck. You'll see it in the sidebar:
- Agent shows ◐ **stalled** status
- The Events view shows `workerbee.stalled` with the reason

To fix it:
1. Click the stalled agent's terminal tab
2. Read the BLOCKED message — maybe it needs a file that doesn't exist yet
3. Either:
   - **Send a message**: Type in the terminal to give the agent more context
   - **Restart**: Right-click the task card → "Restart agent"
   - **Kill & re-dispatch**: Kill the zombie, create a new task with better instructions

---

## Step 8: Complete the manual task

Remember Task 5 (get API key)? Since it's manual:

1. Go to [alphavantage.co](https://www.alphavantage.co/support/#api-key) and get a key
2. Create `.env` in the stock-dashboard project:
   ```
   VITE_ALPHA_VANTAGE_KEY=your_key_here
   ```
3. On the Kanban board, find the manual task card
4. Click **Start** to move it to In Progress
5. Click **Land** when you're done

---

## Step 9: Review the final state

Once all tasks are done:

### Check the git history
```bash
cd C:\Users\colin\Projects\stock-dashboard
git log --oneline
```

You'll see commits from each agent on their branches, plus the `.squan/` task management commits.

### Check the .squan/ directory
```bash
ls .squan/board/landed/
```

All completed tasks are here as markdown files — a permanent record of everything that was built.

### Check the project

```bash
npm run dev
```

Open `http://localhost:5173` — your Stock Price Dashboard is live!

---

## Summary

| Step | What you did | What Squan did |
|------|-------------|----------------|
| 1 | `npm start` | Launched Electron + embedded server |
| 2 | Registered | Created account, stored API key |
| 3 | Created project | Registered git repo in Squan |
| 4 | `init-squan` | Created `.squan/` directory + git commit |
| 5 | Created 5 tasks | Wrote markdown files + dispatched agents |
| 6 | Watched | Agents worked in parallel on git worktrees |
| 7 | Fixed a stall | Restarted agent with new context |
| 8 | Did manual task | Human-in-the-loop for API key |
| 9 | Reviewed | All state in git, app running |
