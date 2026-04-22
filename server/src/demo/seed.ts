/**
 * Demo Seed — Creates the "Demo Finance Dashboard" project with
 * pre-populated agents, release trains, conversations, and kanban state.
 * Designed for live demos — can be loaded and reset with one click.
 */

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'

const DEMO_PROJECT_NAME = 'Demo Finance Dashboard'
const DEMO_REPO_URL = 'https://github.com/tarvitave/squan-demo-finance'
const DEMO_PROJECT_ID = 'demo-finance-dashboard'

// ── Demo data ────────────────────────────────────────────────────────────────

interface DemoAgent {
  id: string
  name: string
  status: 'done' | 'working' | 'stalled' | 'idle'
  role: string
  taskDescription: string
  completionNote: string
  messages: Array<{ type: string; data: any }>
}

interface DemoReleaseTrain {
  id: string
  name: string
  status: 'open' | 'in_progress' | 'pr_review' | 'landed' | 'cancelled'
  description: string
  agentId?: string
}

function buildDemoData(userId: string) {
  const now = new Date().toISOString()
  const agents: DemoAgent[] = [
    {
      id: 'demo-agent-alpha',
      name: 'bee-alpha',
      status: 'done',
      role: 'coder',
      taskDescription: 'Add interactive charts to the dashboard using Chart.js. Replace the placeholder chart with a real line chart showing monthly income vs expenses, and add a donut chart for spending categories.',
      completionNote: 'Added Chart.js with line chart (income vs expenses) and donut chart (spending by category). Both charts use the mock transaction data.',
      messages: [
        { type: 'user', data: { type: 'user', text: 'Add interactive charts to the dashboard using Chart.js. Replace the placeholder chart with a real line chart showing monthly income vs expenses, and add a donut chart for spending categories.' } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "I'll add Chart.js to the project and create interactive charts for the dashboard. Let me start by examining the current codebase structure." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'list_directory', input: { path: '.', recursive: true } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'src/\nsrc/App.jsx\nsrc/main.jsx\nsrc/index.css\nsrc/components/\nsrc/components/Dashboard.jsx\nsrc/components/Sidebar.jsx\nsrc/components/Transactions.jsx\nsrc/components/Accounts.jsx\npackage.json\nvite.config.js\nindex.html' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_2', name: 'read_file', input: { path: 'src/components/Dashboard.jsx' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_2', content: '// Dashboard component with stat cards and placeholder chart\nexport function Dashboard() {\n  return (\n    <div className="p-6">\n      <h1>Dashboard</h1>\n      {/* Stats cards */}\n      <div className="grid grid-cols-4 gap-4">\n        <StatCard title="Total Balance" value="$24,500" />\n        ...\n      </div>\n      {/* Chart placeholder */}\n      <div className="mt-6 bg-white rounded-xl p-4 h-64 flex items-center justify-center text-gray-400">\n        Chart coming soon...\n      </div>\n    </div>\n  )\n}' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_3', name: 'run_command', input: { command: 'npm install chart.js react-chartjs-2' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_3', content: 'added 2 packages in 3.2s' }] } } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'Chart.js installed. Now I\'ll create the chart components and update the Dashboard.' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_4', name: 'write_file', input: { path: 'src/components/IncomeExpenseChart.jsx', content: '// Line chart component...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_4', content: 'Written: src/components/IncomeExpenseChart.jsx (45 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_5', name: 'write_file', input: { path: 'src/components/SpendingDonut.jsx', content: '// Donut chart component...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_5', content: 'Written: src/components/SpendingDonut.jsx (38 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_6', name: 'edit_file', input: { path: 'src/components/Dashboard.jsx', search: 'Chart coming soon...', replace: '<IncomeExpenseChart />' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_6', content: 'Edited: src/components/Dashboard.jsx' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_7', name: 'task_complete', input: { summary: 'Added Chart.js with line chart (income vs expenses by month) and donut chart (spending by category). Both charts render with smooth animations and tooltips.' } }] } } },
      ],
    },
    {
      id: 'demo-agent-bravo',
      name: 'bee-bravo',
      status: 'done',
      role: 'devops',
      taskDescription: 'Set up CI/CD pipeline with GitHub Actions. Add workflows for: lint, test, build on PR. Deploy to Vercel on merge to main.',
      completionNote: 'Created .github/workflows/ci.yml with lint+test+build jobs. Added deploy.yml for Vercel deployment on main branch merges.',
      messages: [
        { type: 'user', data: { type: 'user', text: 'Set up CI/CD pipeline with GitHub Actions. Add workflows for: lint, test, build on PR. Deploy to Vercel on merge to main.' } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "I'll create GitHub Actions workflows for CI/CD. Let me check the project setup first." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: 'package.json' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: '{\n  "name": "finance-dashboard",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "lint": "eslint src/"\n  }\n}' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_2', name: 'write_file', input: { path: '.github/workflows/ci.yml', content: '# CI workflow...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_2', content: 'Written: .github/workflows/ci.yml (42 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_3', name: 'write_file', input: { path: '.github/workflows/deploy.yml', content: '# Deploy workflow...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_3', content: 'Written: .github/workflows/deploy.yml (35 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_4', name: 'task_complete', input: { summary: 'Created CI/CD pipeline: ci.yml runs lint+test+build on PRs, deploy.yml auto-deploys to Vercel on main merges.' } }] } } },
      ],
    },
    {
      id: 'demo-agent-charlie',
      name: 'bee-charlie',
      status: 'done',
      role: 'coder',
      taskDescription: 'Add a login page with email/password form, client-side validation, and a mock auth flow. Store auth state in localStorage.',
      completionNote: 'Created LoginPage component with form validation, mock auth (any email + password "demo123"), and auth context with localStorage persistence.',
      messages: [
        { type: 'user', data: { type: 'user', text: 'Add a login page with email/password form, client-side validation, and a mock auth flow. Store auth state in localStorage.' } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "I'll create a login system with a clean form, validation, and mock authentication. Let me examine the current app structure." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: 'src/App.jsx' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: '// App.jsx with router...' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_2', name: 'write_file', input: { path: 'src/context/AuthContext.jsx', content: '// Auth context with localStorage...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_2', content: 'Written: src/context/AuthContext.jsx (52 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_3', name: 'write_file', input: { path: 'src/components/LoginPage.jsx', content: '// Login page component...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_3', content: 'Written: src/components/LoginPage.jsx (89 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_4', name: 'run_command', input: { command: 'npm run build' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_4', content: 'vite v5.4.0 building for production...\n✓ 28 modules transformed.\ndist/index.html    0.45 kB\ndist/assets/index.js  145.2 kB\n✓ built in 1.8s' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_5', name: 'task_complete', input: { summary: 'Added login page with email/password validation, AuthContext with localStorage persistence, and route protection. Mock auth accepts any email with password "demo123".' } }] } } },
      ],
    },
    {
      id: 'demo-agent-delta',
      name: 'bee-delta',
      status: 'done',
      role: 'coder',
      taskDescription: 'Fix the authentication middleware — the JWT token validation is rejecting valid tokens after 15 minutes. The token expiry check uses seconds but Date.now() returns milliseconds.',
      completionNote: 'Fixed token expiry: changed Date.now() / 1000 comparison. Added 5-minute grace period for clock skew. Added unit test.',
      messages: [
        { type: 'user', data: { type: 'user', text: 'Fix the authentication middleware — the JWT token validation is rejecting valid tokens after 15 minutes. The token expiry check uses seconds but Date.now() returns milliseconds.' } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "Classic timestamp unit mismatch! Let me find the auth middleware and fix the comparison." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'search_files', input: { pattern: 'Date.now()', path: 'src' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'src/middleware/auth.js:12:  if (decoded.exp < Date.now()) {' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_2', name: 'read_file', input: { path: 'src/middleware/auth.js' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_2', content: '// Auth middleware\nfunction validateToken(req, res, next) {\n  const token = req.headers.authorization?.split(" ")[1]\n  const decoded = jwt.verify(token, SECRET)\n  if (decoded.exp < Date.now()) {\n    return res.status(401).json({ error: "Token expired" })\n  }\n  req.user = decoded\n  next()\n}' }] } } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "Found it! Line 12 compares `decoded.exp` (seconds since epoch) with `Date.now()` (milliseconds since epoch). The token appears expired immediately because milliseconds > seconds. Fix: divide Date.now() by 1000." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_3', name: 'edit_file', input: { path: 'src/middleware/auth.js', search: 'if (decoded.exp < Date.now())', replace: 'if (decoded.exp < Math.floor(Date.now() / 1000) - 300)' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_3', content: 'Edited: src/middleware/auth.js' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_4', name: 'task_complete', input: { summary: 'Fixed JWT expiry check: Date.now() / 1000 for seconds comparison. Added 300s (5 min) grace period for clock skew.' } }] } } },
      ],
    },
    {
      id: 'demo-agent-echo',
      name: 'bee-echo',
      status: 'stalled',
      role: 'coder',
      taskDescription: 'Add API rate limiting using express-rate-limit. Limit to 100 requests per 15 minutes per IP. Add special limits for auth endpoints (20 per 15 min).',
      completionNote: '',
      messages: [
        { type: 'user', data: { type: 'user', text: 'Add API rate limiting using express-rate-limit. Limit to 100 requests per 15 minutes per IP. Add special limits for auth endpoints (20 per 15 min).' } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "I'll add rate limiting to protect the API. Let me check the current Express setup." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'run_command', input: { command: 'npm install express-rate-limit' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree\nnpm ERR! peer express@"^4.x" from express-rate-limit@7.1.0' }] } } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "BLOCKED: The project uses Express 5.x but express-rate-limit requires Express 4.x. Need to either downgrade Express or find a compatible rate limiter." }] } } },
      ],
    },
    {
      id: 'demo-agent-foxtrot',
      name: 'bee-foxtrot',
      status: 'done',
      role: 'tester',
      taskDescription: 'Write comprehensive unit tests for the Transactions component. Test filtering, sorting, search, and edge cases (empty data, special characters). Use Vitest + Testing Library.',
      completionNote: 'Created 12 tests covering: render, filter by category, search, sort by date/amount, empty state, special characters. All passing.',
      messages: [
        { type: 'user', data: { type: 'user', text: 'Write comprehensive unit tests for the Transactions component. Test filtering, sorting, search, and edge cases. Use Vitest + Testing Library.' } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "I'll set up Vitest with Testing Library and write thorough tests for the Transactions component." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'run_command', input: { command: 'npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'added 4 packages in 4.1s' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_2', name: 'write_file', input: { path: 'src/components/__tests__/Transactions.test.jsx', content: '// 12 test cases...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_2', content: 'Written: src/components/__tests__/Transactions.test.jsx (156 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_3', name: 'run_command', input: { command: 'npx vitest run' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_3', content: '✓ Transactions.test.jsx (12 tests) 847ms\n  ✓ renders transaction list\n  ✓ filters by category\n  ✓ searches by description\n  ✓ sorts by date ascending\n  ✓ sorts by date descending\n  ✓ sorts by amount\n  ✓ shows empty state\n  ✓ handles special characters in search\n  ✓ filters and searches combined\n  ✓ displays correct totals\n  ✓ pagination works\n  ✓ reset filters button works\n\nTest Files  1 passed (1)\nTests  12 passed (12)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_4', name: 'task_complete', input: { summary: 'Created 12 tests for Transactions component. All passing. Covers: render, filter, search, sort, empty state, special chars, pagination, reset.' } }] } } },
      ],
    },
    {
      id: 'demo-agent-golf',
      name: 'bee-golf',
      status: 'done',
      role: 'reviewer',
      taskDescription: 'Perform a security audit of the finance dashboard. Check for XSS vulnerabilities, insecure data handling, missing input sanitization, and hardcoded credentials.',
      completionNote: 'Found 3 issues: XSS via unsanitized transaction notes, localStorage token not httpOnly, no CSRF protection. Created SECURITY-AUDIT.md with findings and recommendations.',
      messages: [
        { type: 'user', data: { type: 'user', text: 'Perform a security audit of the finance dashboard. Check for XSS, insecure data handling, missing sanitization, and hardcoded credentials.' } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "I'll do a thorough security review of the codebase. Let me scan all source files." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'search_files', input: { pattern: 'dangerouslySetInnerHTML', path: 'src' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'src/components/Transactions.jsx:45:    <span dangerouslySetInnerHTML={{ __html: tx.notes }} />' }] } } },
        { type: 'assistant', data: { type: 'assistant', message: { content: [{ type: 'text', text: "🚨 **Critical XSS vulnerability found!** `dangerouslySetInnerHTML` is used to render transaction notes without sanitization. An attacker could inject malicious scripts through transaction data." }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_2', name: 'search_files', input: { pattern: 'localStorage', path: 'src' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_2', content: 'src/context/AuthContext.jsx:8:  const token = localStorage.getItem("auth_token")\nsrc/context/AuthContext.jsx:15:  localStorage.setItem("auth_token", token)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_3', name: 'write_file', input: { path: 'SECURITY-AUDIT.md', content: '# Security Audit Report\n\n## Critical\n1. XSS via dangerouslySetInnerHTML...\n\n## Medium\n2. Auth token in localStorage...\n\n## Low\n3. No CSRF protection...' } }] } } },
        { type: 'tool_result', data: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_3', content: 'Written: SECURITY-AUDIT.md (45 lines)' }] } } },
        { type: 'tool', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_4', name: 'task_complete', input: { summary: 'Security audit complete. Found 3 issues: XSS via dangerouslySetInnerHTML (critical), localStorage token exposure (medium), no CSRF protection (low). Report saved to SECURITY-AUDIT.md.' } }] } } },
      ],
    },
  ]

  const releaseTrains: DemoReleaseTrain[] = [
    // Open — ready to be dispatched
    { id: 'demo-rt-darkmode', name: 'Add dark mode toggle', status: 'open',
      description: 'Implement a dark/light mode toggle in the sidebar. Use CSS custom properties for theming. Persist preference in localStorage. Apply to all components.' },
    { id: 'demo-rt-mobile', name: 'Mobile responsive layout', status: 'open',
      description: 'Make the dashboard fully responsive. Collapsible sidebar on mobile, stack cards vertically, responsive chart sizes, touch-friendly interactions.' },
    // In Progress — agents actively working or done but not advanced
    { id: 'demo-rt-auth', name: 'Fix auth token expiry bug', status: 'in_progress', agentId: 'demo-agent-delta',
      description: 'Fix the authentication middleware — JWT token validation rejects valid tokens after 15 minutes. The token expiry check uses seconds but Date.now() returns milliseconds.' },
    { id: 'demo-rt-ratelimit', name: 'Add API rate limiting', status: 'in_progress', agentId: 'demo-agent-echo',
      description: 'Add API rate limiting using express-rate-limit. 100 req/15min per IP. Special auth endpoint limits.' },
    // PR Review — agent finished, awaiting human review
    { id: 'demo-rt-charts', name: 'Add interactive charts', status: 'pr_review', agentId: 'demo-agent-alpha',
      description: 'Add interactive charts to the dashboard using Chart.js. Line chart for income vs expenses, donut chart for spending categories.' },
    { id: 'demo-rt-security', name: 'Security audit', status: 'pr_review', agentId: 'demo-agent-golf',
      description: 'Full security review — check for XSS, insecure data handling, missing sanitization, hardcoded credentials.' },
    // Landed — completed and merged
    { id: 'demo-rt-cicd', name: 'Setup CI/CD pipeline', status: 'landed', agentId: 'demo-agent-bravo',
      description: 'GitHub Actions for lint+test+build on PR, auto-deploy to Vercel on merge to main.' },
    { id: 'demo-rt-login', name: 'Add login page', status: 'landed', agentId: 'demo-agent-charlie',
      description: 'Login page with email/password form, client-side validation, mock auth flow, localStorage persistence.' },
  ]

  // Charter — accumulated knowledge
  const charter = `# Finance Dashboard — Coder Knowledge

## Tech Stack
- React 18 + Vite + Tailwind CSS
- No TypeScript (plain JSX)
- Mock data in components (no real API)

## Conventions
- Components in src/components/
- Use Tailwind utility classes, no CSS modules
- State management via React Context (AuthContext)
- Mock auth: any email + password "demo123"

## Known Issues
- dangerouslySetInnerHTML in Transactions.jsx (XSS risk)
- No Express backend yet — pure frontend
- Chart.js added but not tree-shaken

## Lessons Learned
- Express 5.x breaks express-rate-limit compatibility
- Always use Math.floor(Date.now() / 1000) when comparing JWT exp timestamps
- Vitest needs jsdom environment for React component tests
`

  return { agents, releaseTrains, charter, now }
}

// ── Load demo ────────────────────────────────────────────────────────────────

export async function loadDemo(userId: string): Promise<{ projectId: string; agents: number; releaseTrains: number }> {
  const db = getDb()
  const { agents, releaseTrains, charter, now } = buildDemoData(userId)

  // Clean up any existing demo data first
  await resetDemo()

  // Find or create a town for the demo project
  const towns = await db.execute({ sql: 'SELECT id FROM towns LIMIT 1', args: [] })
  const townId = towns.rows[0]?.id as string ?? 'demo-town'
  if (!towns.rows[0]) {
    await db.execute({ sql: `INSERT INTO towns (id, path, name, user_id, created_at) VALUES (?, ?, 'Demo', ?, ?)`, args: ['demo-town', 'demo', userId, now] })
  }

  // Create demo project
  await db.execute({
    sql: `INSERT OR REPLACE INTO rigs (id, name, local_path, repo_url, town_id, user_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [DEMO_PROJECT_ID, DEMO_PROJECT_NAME, '', DEMO_REPO_URL, townId, userId, now],
  })

  // Create agents
  for (const agent of agents) {
    await db.execute({
      sql: `INSERT INTO workerbees (id, rig_id, name, branch, worktree_path, task_description, completion_note, role, status, hook_id, session_id, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      args: [agent.id, DEMO_PROJECT_ID, agent.name, `workerbee/${agent.name}-demo`, agent.taskDescription, agent.completionNote, agent.role, agent.status, userId, now, now],
    })

    // Insert conversation messages
    for (const msg of agent.messages) {
      await db.execute({
        sql: `INSERT INTO workerbee_messages (workerbee_id, message_json, created_at) VALUES (?, ?, ?)`,
        args: [agent.id, JSON.stringify(msg.data), now],
      })
    }
  }

  // Create release trains
  for (const rt of releaseTrains) {
    await db.execute({
      sql: `INSERT INTO release_trains (id, name, description, rig_id, status, assigned_workerbee_id, user_id, created_at, updated_at, atomic_task_ids_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
      args: [rt.id, rt.name, rt.description, DEMO_PROJECT_ID, rt.status, rt.agentId || null, userId, now, now],
    })
  }

  // Create charter
  await db.execute({
    sql: `INSERT OR REPLACE INTO charters (project_id, role, content) VALUES (?, ?, ?)`,
    args: [DEMO_PROJECT_ID, 'coder', charter],
  })

  return { projectId: DEMO_PROJECT_ID, agents: agents.length, releaseTrains: releaseTrains.length }
}

// ── Reset demo ───────────────────────────────────────────────────────────────

export async function resetDemo(): Promise<void> {
  const db = getDb()

  // Delete all demo data by ID prefix
  await db.execute({ sql: `DELETE FROM workerbee_messages WHERE workerbee_id LIKE 'demo-agent-%'`, args: [] })
  await db.execute({ sql: `DELETE FROM workerbees WHERE id LIKE 'demo-agent-%'`, args: [] })
  await db.execute({ sql: `DELETE FROM release_trains WHERE id LIKE 'demo-rt-%'`, args: [] })
  await db.execute({ sql: `DELETE FROM atomic_tasks WHERE project_id = ?`, args: [DEMO_PROJECT_ID] })
  await db.execute({ sql: `DELETE FROM charters WHERE project_id = ?`, args: [DEMO_PROJECT_ID] })
  await db.execute({ sql: `DELETE FROM rigs WHERE id = ?`, args: [DEMO_PROJECT_ID] })
}

// ── Check if demo is loaded ──────────────────────────────────────────────────

export async function isDemoLoaded(): Promise<boolean> {
  const db = getDb()
  const result = await db.execute({ sql: `SELECT COUNT(*) as n FROM rigs WHERE id = ?`, args: [DEMO_PROJECT_ID] })
  return (result.rows[0]?.n as number) > 0
}

export const DEMO_PROJECT = { id: DEMO_PROJECT_ID, name: DEMO_PROJECT_NAME, repoUrl: DEMO_REPO_URL }
