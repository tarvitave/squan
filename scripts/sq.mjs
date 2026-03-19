#!/usr/bin/env node
/**
 * sq — Squansq CLI
 * Usage: node scripts/sq.mjs <command> [args]
 *
 * Config: ~/.squansq (JSON with url + token), or env SQUANSQ_URL / SQUANSQ_TOKEN
 * Run `sq login` to save credentials.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), '.squansq')

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function getBase() {
  return process.env.SQUANSQ_URL ?? loadConfig().url ?? 'http://localhost:3001'
}

function getToken() {
  return process.env.SQUANSQ_TOKEN ?? loadConfig().token ?? ''
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${getBase()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    let msg
    try { msg = JSON.parse(text).error } catch { msg = text }
    throw new Error(`HTTP ${res.status}: ${msg}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  teal:  '\x1b[36m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  blue:  '\x1b[34m',
  gray:  '\x1b[90m',
  white: '\x1b[97m',
}

function c(color, text) { return `${C[color]}${text}${C.reset}` }

function statusColor(status) {
  switch (status) {
    case 'working':    return c('green', status)
    case 'done':       return c('teal', status)
    case 'idle':       return c('blue', status)
    case 'stalled':    return c('yellow', status)
    case 'zombie':     return c('red', status)
    case 'open':       return c('blue', status)
    case 'in_progress':return c('green', status)
    case 'landed':     return c('teal', status)
    case 'cancelled':  return c('gray', status)
    case 'blocked':    return c('red', status)
    default:           return status
  }
}

function col(text, width) {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '')
  return text + ' '.repeat(Math.max(0, width - plain.length))
}

// ── Commands ──────────────────────────────────────────────────────────────────

const COMMANDS = {

  async login(args) {
    if (args.length < 2) {
      console.log(`Usage: sq login <url> <token>`)
      console.log(`  e.g. sq login http://localhost:3001 eyJhbGc...`)
      return
    }
    const [url, token] = args
    writeFileSync(CONFIG_PATH, JSON.stringify({ url, token }, null, 2))
    console.log(c('green', `✓ Saved to ${CONFIG_PATH}`))
  },

  async status() {
    const data = await api('GET', '/api/mcp/tools')
    // Use MCP get_status_summary via direct REST instead
    const summary = await api('POST', '/api/mcp', {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_status_summary', arguments: {} },
    })
    const s = JSON.parse(summary.result.content[0].text)

    console.log(c('bold', '\n── Projects ─────────────────────────────────'))
    for (const p of s.projects ?? []) {
      console.log(`  ${c('teal', p.name)}  ${c('gray', p.id)}`)
    }

    console.log(c('bold', '\n── Agents ───────────────────────────────────'))
    if (!s.workerbees?.length) {
      console.log(c('gray', '  (none)'))
    } else {
      for (const b of s.workerbees) {
        const train = b.releaseTrain ? c('gray', ` [${b.releaseTrain.name}]`) : ''
        const task = b.taskDescription ? c('gray', `  ${b.taskDescription.slice(0, 60)}`) : ''
        console.log(`  ${col(c('teal', b.name), 22)} ${col(statusColor(b.status), 20)}${train}${task}`)
      }
    }

    console.log(c('bold', '\n── Release Trains ───────────────────────────'))
    if (!s.releaseTrains?.length) {
      console.log(c('gray', '  (none)'))
    } else {
      for (const rt of s.releaseTrains) {
        const bee = rt.assignedBee ? c('gray', ` → ${rt.assignedBee}`) : ''
        const taskSummary = rt.atomicTasks?.length
          ? c('gray', `  (${rt.atomicTasks.filter(t => t.status === 'done').length}/${rt.atomicTasks.length} tasks done)`)
          : ''
        console.log(`  ${col(c('blue', rt.name), 30)} ${col(statusColor(rt.status), 20)}${bee}${taskSummary}`)
        for (const t of rt.atomicTasks ?? []) {
          console.log(`    ${c('gray', '·')} ${col(statusColor(t.status), 14)} ${t.title}`)
        }
      }
    }
    console.log()
  },

  async agents() {
    const bees = await api('GET', '/api/workerbees')
    if (!bees.length) { console.log(c('gray', '(no agents)')); return }
    console.log()
    console.log(`  ${col(c('bold','NAME'), 20)} ${col(c('bold','STATUS'), 14)} ${c('bold','TASK')}`)
    console.log('  ' + '─'.repeat(70))
    for (const b of bees) {
      const task = (b.taskDescription ?? '').slice(0, 50)
      console.log(`  ${col(c('teal', b.name), 20)} ${col(statusColor(b.status), 14)} ${c('gray', task)}`)
    }
    console.log()
  },

  async projects() {
    const rigs = await api('GET', '/api/rigs')
    if (!rigs.length) { console.log(c('gray', '(no projects)')); return }
    console.log()
    for (const r of rigs) {
      console.log(`  ${c('teal', r.name)}`)
      console.log(`    ${c('gray', 'id:')}  ${r.id}`)
      console.log(`    ${c('gray', 'path:')} ${r.localPath ?? '—'}`)
      console.log(`    ${c('gray', 'repo:')} ${r.repoUrl ?? '—'}`)
    }
    console.log()
  },

  async trains(args) {
    const status = args[0]
    const url = status ? `/api/release-trains?status=${status}` : '/api/release-trains'
    const trains = await api('GET', url)
    if (!trains.length) { console.log(c('gray', '(no release trains)')); return }
    console.log()
    console.log(`  ${col(c('bold','ID (short)'), 12)} ${col(c('bold','STATUS'), 14)} ${col(c('bold','AGENT'), 18)} ${c('bold','NAME')}`)
    console.log('  ' + '─'.repeat(75))
    for (const rt of trains) {
      console.log(`  ${col(c('gray', rt.id.slice(0,8)), 12)} ${col(statusColor(rt.status), 14)} ${col(rt.assignedWorkerBeeId ? c('teal','assigned') : c('gray','—'), 18)} ${rt.name}`)
    }
    console.log()
  },

  async train(args) {
    if (!args[0]) { console.error('Usage: sq train <id>'); process.exit(1) }
    const summary = await api('POST', '/api/mcp', {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_release_train', arguments: { releaseTrainId: await resolveTrainId(args[0]) } },
    })
    const rt = JSON.parse(summary.result.content[0].text)
    console.log()
    console.log(`  ${c('bold', rt.name)}  ${statusColor(rt.status)}`)
    console.log(`  ${c('gray', 'id:')} ${rt.id}`)
    if (rt.assignedBee) {
      console.log(`  ${c('gray', 'agent:')} ${c('teal', rt.assignedBee.name)}  ${statusColor(rt.assignedBee.status)}`)
      if (rt.assignedBee.completionNote) console.log(`  ${c('gray', 'note:')} ${rt.assignedBee.completionNote}`)
    }
    if (rt.description) console.log(`\n  ${c('gray', rt.description.slice(0, 200))}`)
    if (rt.atomicTasks?.length) {
      console.log(`\n  ${c('bold', 'Tasks:')}`)
      for (const t of rt.atomicTasks) {
        console.log(`    ${col(statusColor(t.status), 14)} ${t.title}  ${c('gray', t.id.slice(0,8))}`)
      }
    }
    console.log()
  },

  async dispatch(args) {
    if (!args[0]) { console.error('Usage: sq dispatch <release-train-id>'); process.exit(1) }
    const rtId = await resolveTrainId(args[0])
    const result = await api('POST', '/api/mcp', {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'dispatch_release_train', arguments: { releaseTrainId: rtId } },
    })
    const data = JSON.parse(result.result.content[0].text)
    console.log(c('green', `✓ Dispatched`) + ` → agent ${c('teal', data.bee.name)} on branch ${c('gray', data.bee.branch)}`)
  },

  async kill(args) {
    if (!args[0]) { console.error('Usage: sq kill <agent-name-or-id>'); process.exit(1) }
    const beeId = await resolveBeeId(args[0])
    await api('DELETE', `/api/workerbees/${beeId}`)
    console.log(c('green', `✓ Killed ${args[0]}`))
  },

  async restart(args) {
    if (!args[0]) { console.error('Usage: sq restart <agent-name-or-id>'); process.exit(1) }
    const beeId = await resolveBeeId(args[0])
    const data = await api('POST', `/api/workerbees/${beeId}/restart`)
    console.log(c('green', `✓ Restarted`) + ` → new agent ${c('teal', data.bee.name)}`)
  },

  async spawn(args) {
    if (args.length < 2) { console.error('Usage: sq spawn <project-id-or-name> "<task>"'); process.exit(1) }
    const projectId = await resolveProjectId(args[0])
    const task = args.slice(1).join(' ')
    const bee = await api('POST', '/api/workerbees', { projectId, taskDescription: task })
    console.log(c('green', `✓ Spawned ${c('teal', bee.name)}`) + `  branch: ${c('gray', bee.branch)}`)
  },

  async 'create-train'(args) {
    if (args.length < 2) { console.error('Usage: sq create-train <project-id-or-name> "<name>" ["<description>"]'); process.exit(1) }
    const projectId = await resolveProjectId(args[0])
    const name = args[1]
    const description = args.slice(2).join(' ')
    const rt = await api('POST', '/api/release-trains', { projectId, name, description })
    console.log(c('green', `✓ Created release train`) + `  ${c('teal', rt.name)}  ${c('gray', rt.id.slice(0,8))}`)
  },

  async land(args) {
    if (!args[0]) { console.error('Usage: sq land <release-train-id>'); process.exit(1) }
    const rtId = await resolveTrainId(args[0])
    await api('POST', `/api/release-trains/${rtId}/land`)
    console.log(c('green', `✓ Landed`))
  },

  async tasks(args) {
    const rtId = args[0] ? await resolveTrainId(args[0]) : undefined
    const url = rtId ? `/api/atomictasks?releaseTrainId=${rtId}` : '/api/atomictasks'
    const tasks = await api('GET', url)
    if (!tasks.length) { console.log(c('gray', '(no tasks)')); return }
    console.log()
    for (const t of tasks) {
      console.log(`  ${col(c('gray', t.id.slice(0,8)), 10)} ${col(statusColor(t.status), 14)} ${t.title}`)
    }
    console.log()
  },

  async task(args) {
    if (args.length < 2) { console.error('Usage: sq task <release-train-id> "<title>" ["<description>"]'); process.exit(1) }
    const rtId = await resolveTrainId(args[0])
    const title = args[1]
    const description = args.slice(2).join(' ')
    // Get project ID from release train
    const trains = await api('GET', '/api/release-trains')
    const rt = trains.find(r => r.id === rtId)
    if (!rt) throw new Error('Release train not found')
    const t = await api('POST', '/api/atomictasks', { projectId: rt.projectId, releaseTrainId: rtId, title, description })
    console.log(c('green', `✓ Created task`) + `  ${t.title}  ${c('gray', t.id.slice(0,8))}`)
  },

  async done(args) {
    if (!args[0]) { console.error('Usage: sq done <task-id>'); process.exit(1) }
    await api('PATCH', `/api/atomictasks/${args[0]}/status`, { status: 'done' })
    console.log(c('green', `✓ Marked done`))
  },

  async send(args) {
    if (args.length < 2) { console.error('Usage: sq send <agent-name-or-id> "<message>"'); process.exit(1) }
    const beeId = await resolveBeeId(args[0])
    const message = args.slice(1).join(' ')
    await api('POST', `/api/workerbees/${beeId}/message`, { message })
    console.log(c('green', `✓ Sent`))
  },

  help() {
    console.log(`
${c('bold', 'sq')} — Squansq CLI

${c('bold', 'Setup')}
  sq login <url> <token>          Save server URL and auth token to ~/.squansq

${c('bold', 'Overview')}
  sq status                       Full orchestration overview (agents, trains, tasks)
  sq agents                       List all agents
  sq projects                     List all projects
  sq trains [status]              List release trains (filter: open, in_progress, landed)
  sq train <id>                   Details of a specific release train

${c('bold', 'Agents')}
  sq spawn <project> "<task>"     Spawn an agent directly
  sq kill <name-or-id>            Kill an agent
  sq restart <name-or-id>         Restart a zombie/stalled agent
  sq send <name-or-id> "<msg>"    Send a message to an agent's terminal

${c('bold', 'Release Trains')}
  sq create-train <proj> "<name>" ["<desc>"]   Create a release train
  sq dispatch <id>                Spawn an agent and assign it to a release train
  sq land <id>                    Mark a release train as complete

${c('bold', 'Atomic Tasks')}
  sq tasks [release-train-id]     List atomic tasks
  sq task <rt-id> "<title>" ["<desc>"]         Create an atomic task
  sq done <task-id>               Mark a task as done

${c('gray', 'IDs can be full UUIDs or the first 8 characters. Agent names (e.g. bee-alpha) also work.')}
`)
  },
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

async function resolveBeeId(nameOrId) {
  const bees = await api('GET', '/api/workerbees')
  const match = bees.find(b => b.id === nameOrId || b.id.startsWith(nameOrId) || b.name === nameOrId)
  if (!match) throw new Error(`Agent not found: ${nameOrId}`)
  return match.id
}

async function resolveTrainId(nameOrId) {
  const trains = await api('GET', '/api/release-trains')
  const match = trains.find(rt => rt.id === nameOrId || rt.id.startsWith(nameOrId) || rt.name === nameOrId)
  if (!match) throw new Error(`Release train not found: ${nameOrId}`)
  return match.id
}

async function resolveProjectId(nameOrId) {
  const rigs = await api('GET', '/api/rigs')
  const match = rigs.find(r => r.id === nameOrId || r.id.startsWith(nameOrId) || r.name === nameOrId)
  if (!match) throw new Error(`Project not found: ${nameOrId}`)
  return match.id
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  COMMANDS.help()
  process.exit(0)
}

const handler = COMMANDS[cmd]
if (!handler) {
  console.error(c('red', `Unknown command: ${cmd}`))
  console.error(`Run ${c('teal', 'sq help')} for available commands.`)
  process.exit(1)
}

handler(args).catch((err) => {
  console.error(c('red', `Error: ${err.message}`))
  process.exit(1)
})
