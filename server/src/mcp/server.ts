/**
 * Squansq MCP Server
 * Exposes orchestration capabilities as MCP tools for AI agents.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST /api/mcp
 * Tool discovery: GET /api/mcp/tools
 */

import type { Request, Response } from 'express'
import { workerBeeManager, charterManager, routingManager } from '../workerbee/manager.js'
import { releaseTrainManager } from '../releasetrain/manager.js'
import { atomicTaskManager } from '../beads/manager.js'
import { rigManager } from '../rig/manager.js'
import { hookManager } from '../hooks/manager.js'

// Tool definitions
const TOOLS = [
  {
    name: 'list_workerbees',
    description: 'List all WorkerBee agents and their current status',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string', description: 'Filter by project ID (optional)' } } },
  },
  {
    name: 'spawn_workerbee',
    description: 'Spawn a new WorkerBee agent for a project with an optional task description',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        taskDescription: { type: 'string', description: 'Task for the agent — written as CLAUDE.md in its worktree' },
      },
    },
  },
  {
    name: 'get_workerbee',
    description: 'Get details and current status of a specific WorkerBee',
    inputSchema: { type: 'object', required: ['workerBeeId'], properties: { workerBeeId: { type: 'string' } } },
  },
  {
    name: 'kill_workerbee',
    description: 'Stop and remove a WorkerBee agent',
    inputSchema: { type: 'object', required: ['workerBeeId'], properties: { workerBeeId: { type: 'string' } } },
  },
  {
    name: 'list_projects',
    description: 'List all projects (git repositories)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_release_trains',
    description: 'List all release trains (work bundles)',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status: open, in_progress, landed, cancelled' } } },
  },
  {
    name: 'create_release_train',
    description: 'Create a new release train (work bundle) for a project',
    inputSchema: {
      type: 'object',
      required: ['name', 'projectId'],
      properties: {
        name: { type: 'string' },
        projectId: { type: 'string' },
        description: { type: 'string', description: 'Detailed task description — used as CLAUDE.md when dispatched' },
      },
    },
  },
  {
    name: 'dispatch_release_train',
    description: 'Spawn a WorkerBee and assign it to a release train. The release train description becomes the agent\'s task.',
    inputSchema: { type: 'object', required: ['releaseTrainId'], properties: { releaseTrainId: { type: 'string' } } },
  },
  {
    name: 'land_release_train',
    description: 'Mark a release train as landed (completed)',
    inputSchema: { type: 'object', required: ['releaseTrainId'], properties: { releaseTrainId: { type: 'string' } } },
  },
  {
    name: 'list_atomic_tasks',
    description: 'List atomic tasks (atomic work items)',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        releaseTrainId: { type: 'string' },
      },
    },
  },
  {
    name: 'create_atomic_task',
    description: 'Create a new atomic task (atomic work item)',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        releaseTrainId: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' }, description: 'AtomicTask IDs this depends on' },
      },
    },
  },
  {
    name: 'list_hooks',
    description: 'List hooks (persistent work units linked to git branches)',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
  },
  {
    name: 'get_status_summary',
    description: 'Get a high-level summary of the current orchestration state',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_release_train',
    description: 'Get full details of a release train including its atomic tasks and assigned agent',
    inputSchema: { type: 'object', required: ['releaseTrainId'], properties: { releaseTrainId: { type: 'string' } } },
  },
  {
    name: 'update_atomic_task',
    description: 'Update the status of an atomic task. Use this to track progress as work is completed.',
    inputSchema: {
      type: 'object',
      required: ['atomicTaskId', 'status'],
      properties: {
        atomicTaskId: { type: 'string' },
        status: { type: 'string', description: 'One of: open, in_progress, done, blocked' },
      },
    },
  },
  {
    name: 'update_release_train',
    description: 'Update the description of a release train (e.g. to add context or refine the task before dispatching)',
    inputSchema: {
      type: 'object',
      required: ['releaseTrainId', 'description'],
      properties: {
        releaseTrainId: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
  {
    name: 'get_charter',
    description: 'Get the accumulated knowledge charter for a role on a project. Charters grow as agents complete work and log LEARNINGS.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'role'],
      properties: {
        projectId: { type: 'string' },
        role: { type: 'string', description: 'Agent role: coder, tester, reviewer, devops, lead' },
      },
    },
  },
  {
    name: 'update_charter',
    description: 'Update or create the knowledge charter for a role on a project.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'role', 'content'],
      properties: {
        projectId: { type: 'string' },
        role: { type: 'string' },
        content: { type: 'string', description: 'Charter content — accumulated knowledge, conventions, and lessons learned' },
      },
    },
  },
  {
    name: 'list_routing_rules',
    description: 'List domain routing rules for a project. Rules map task keyword patterns to agent roles.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string' } },
    },
  },
  {
    name: 'set_routing_rule',
    description: 'Set a routing rule: when a task description contains this pattern, assign the given role.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'pattern', 'role'],
      properties: {
        projectId: { type: 'string' },
        pattern: { type: 'string', description: 'Keyword or phrase to match in task descriptions (case-insensitive)' },
        role: { type: 'string', description: 'Role to assign: coder, tester, reviewer, devops, lead' },
      },
    },
  },
  {
    name: 'suggest_role',
    description: 'Given a task description, suggest the best agent role based on routing rules and built-in heuristics.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'taskDescription'],
      properties: {
        projectId: { type: 'string' },
        taskDescription: { type: 'string' },
      },
    },
  },
]

async function callTool(name: string, args: Record<string, unknown>, townId?: string): Promise<unknown> {
  switch (name) {
    case 'list_workerbees': {
      const all = await workerBeeManager.listAll()
      if (args.projectId) return all.filter((b) => b.projectId === args.projectId)
      if (townId) {
        const townProjects = await rigManager.listByTown(townId)
        const projectIds = new Set(townProjects.map((p) => p.id))
        return all.filter((b) => projectIds.has(b.projectId))
      }
      return all
    }
    case 'spawn_workerbee': {
      const role = (args.role as string | undefined) ?? (() => {
        // Auto-suggest role if not provided
        return routingManager.suggest(args.taskDescription as string ?? '', [])
      })()
      return workerBeeManager.spawn(args.projectId as string, args.taskDescription as string | undefined, undefined, role)
    }
    case 'get_workerbee': {
      const bee = await workerBeeManager.getById(args.workerBeeId as string)
      if (!bee) throw new Error(`WorkerBee ${args.workerBeeId} not found`)
      return bee
    }
    case 'kill_workerbee': {
      await workerBeeManager.nuke(args.workerBeeId as string)
      return { ok: true }
    }
    case 'list_projects': {
      const all = await rigManager.listAll()
      return townId ? all.filter((r) => r.townId === townId) : all
    }
    case 'list_release_trains': {
      const all = await releaseTrainManager.listAll()
      return args.status ? all.filter((c) => c.status === args.status) : all
    }
    case 'create_release_train': {
      return releaseTrainManager.create(args.name as string, args.projectId as string, [], args.description as string | undefined)
    }
    case 'dispatch_release_train': {
      const releaseTrain = await releaseTrainManager.getById(args.releaseTrainId as string)
      if (!releaseTrain) throw new Error(`ReleaseTrain ${args.releaseTrainId} not found`)
      const task = releaseTrain.description || releaseTrain.name
      // Auto-suggest role from routing rules + heuristics if not explicitly provided
      const rules = (await routingManager.list(releaseTrain.projectId)) as unknown as Array<{ pattern: string; role: string }>
      const role = (args.role as string | undefined) ?? routingManager.suggest(task, rules)
      const bee = await workerBeeManager.spawn(releaseTrain.projectId, task, undefined, role)
      await releaseTrainManager.assignWorkerBee(releaseTrain.id, bee.id)
      return { bee, releaseTrain: await releaseTrainManager.getById(releaseTrain.id) }
    }
    case 'land_release_train': {
      await releaseTrainManager.land(args.releaseTrainId as string)
      return { ok: true }
    }
    case 'list_atomic_tasks': {
      const rtId = (args.releaseTrainId ?? args.convoyId) as string | undefined
      if (rtId) return atomicTaskManager.listByConvoy(rtId)
      if (args.projectId) return atomicTaskManager.listByProject(args.projectId as string)
      return atomicTaskManager.listAll()
    }
    case 'create_atomic_task': {
      const atomicTask = await atomicTaskManager.create(
        args.projectId as string,
        args.title as string,
        args.description as string | undefined,
        (args.releaseTrainId ?? args.convoyId) as string | undefined,
        args.dependsOn as string[] | undefined
      )
      return atomicTask
    }
    case 'list_hooks': {
      if (args.projectId) return hookManager.listByProject(args.projectId as string)
      return hookManager.listAll()
    }
    case 'get_status_summary': {
      const allProjects = townId ? await rigManager.listByTown(townId) : await rigManager.listAll()
      const projectIds = new Set(allProjects.map((p) => p.id))
      const [allBees, allReleaseTrains, allAtomicTasks] = await Promise.all([
        workerBeeManager.listAll(),
        releaseTrainManager.listAll(),
        atomicTaskManager.listAll(),
      ])
      const bees = allBees.filter((b) => projectIds.has(b.projectId))
      const releaseTrains = allReleaseTrains.filter((rt) => projectIds.has(rt.projectId))
      const atomicTasks = allAtomicTasks.filter((t) => projectIds.has(t.projectId))

      // Build release train lookup for bee → train name
      const trainByBeeId = Object.fromEntries(
        releaseTrains.filter((rt) => rt.assignedWorkerBeeId).map((rt) => [rt.assignedWorkerBeeId!, rt])
      )

      return {
        projects: allProjects.map((p) => ({ id: p.id, name: p.name, localPath: p.localPath })),
        workerbees: bees.map((b) => ({
          id: b.id,
          name: b.name,
          role: b.role ?? 'coder',
          status: b.status,
          taskDescription: b.taskDescription?.slice(0, 120) ?? '',
          branch: b.branch,
          releaseTrain: trainByBeeId[b.id] ? { id: trainByBeeId[b.id].id, name: trainByBeeId[b.id].name } : null,
          completionNote: b.completionNote?.slice(0, 120) ?? '',
        })),
        releaseTrains: releaseTrains.map((rt) => {
          const rtTasks = atomicTasks.filter((t) => t.releaseTrainId === rt.id)
          return {
            id: rt.id,
            name: rt.name,
            status: rt.status,
            assignedBee: rt.assignedWorkerBeeId ? (bees.find((b) => b.id === rt.assignedWorkerBeeId)?.name ?? rt.assignedWorkerBeeId) : null,
            atomicTasks: rtTasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
          }
        }),
        unassignedAtomicTasks: atomicTasks
          .filter((t) => !t.releaseTrainId)
          .map((t) => ({ id: t.id, title: t.title, status: t.status })),
      }
    }
    case 'get_release_train': {
      const rt = await releaseTrainManager.getById(args.releaseTrainId as string)
      if (!rt) throw new Error(`ReleaseTrain ${args.releaseTrainId} not found`)
      const tasks = await atomicTaskManager.listByConvoy(rt.id)
      const bee = rt.assignedWorkerBeeId ? await workerBeeManager.getById(rt.assignedWorkerBeeId) : null
      return {
        ...rt,
        atomicTasks: tasks,
        assignedBee: bee ? { id: bee.id, name: bee.name, status: bee.status, completionNote: bee.completionNote } : null,
      }
    }
    case 'update_atomic_task': {
      const task = await atomicTaskManager.setStatus(args.atomicTaskId as string, args.status as 'open' | 'in_progress' | 'done' | 'blocked')
      return task
    }
    case 'update_release_train': {
      const rt = await releaseTrainManager.updateDescription(args.releaseTrainId as string, args.description as string)
      return rt
    }
    case 'get_charter': {
      const charter = await charterManager.get(args.projectId as string, args.role as string)
      return charter ?? { content: '', message: 'No charter yet — one will be created after the first agent completes work.' }
    }
    case 'update_charter': {
      return charterManager.upsert(args.projectId as string, args.role as string, args.content as string)
    }
    case 'list_routing_rules': {
      return routingManager.list(args.projectId as string)
    }
    case 'set_routing_rule': {
      return routingManager.set(args.projectId as string, args.pattern as string, args.role as string)
    }
    case 'suggest_role': {
      const rules = (await routingManager.list(args.projectId as string)) as unknown as Array<{ pattern: string; role: string }>
      const role = routingManager.suggest(args.taskDescription as string, rules)
      return { role, reason: `Matched routing rules or heuristics for: "${args.taskDescription}"` }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export function handleMcpToolsList(_req: Request, res: Response) {
  res.json({ tools: TOOLS })
}

export async function handleMcpCall(req: Request, res: Response) {
  const townId = req.query.townId as string | undefined
  const { jsonrpc, method, params, id } = req.body

  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null })
  }

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'squansq', version: '1.0.0' },
      },
      id,
    })
  }

  if (method === 'notifications/initialized') {
    return res.status(204).end()
  }

  if (method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', result: { tools: TOOLS }, id })
  }

  if (method === 'tools/call') {
    const { name, arguments: toolArgs = {} } = params ?? {}
    try {
      const result = await callTool(name, toolArgs, townId)
      return res.json({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }, id })
    } catch (err) {
      return res.json({
        jsonrpc: '2.0',
        error: { code: -32603, message: (err as Error).message },
        id,
      })
    }
  }

  return res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id })
}
