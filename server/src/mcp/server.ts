/**
 * Squansq MCP Server
 * Exposes orchestration capabilities as MCP tools for AI agents.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST /api/mcp
 * Tool discovery: GET /api/mcp/tools
 */

import type { Request, Response } from 'express'
import { workerBeeManager } from '../workerbee/manager.js'
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
]

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_workerbees': {
      const all = await workerBeeManager.listAll()
      return args.projectId ? all.filter((b) => b.projectId === args.projectId) : all
    }
    case 'spawn_workerbee': {
      return workerBeeManager.spawn(args.projectId as string, args.taskDescription as string | undefined)
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
      return rigManager.listAll()
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
      const bee = await workerBeeManager.spawn(releaseTrain.projectId, task)
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
      const [bees, releaseTrains, atomicTasks] = await Promise.all([
        workerBeeManager.listAll(),
        releaseTrainManager.listAll(),
        atomicTaskManager.listAll(),
      ])
      const beesByStatus = bees.reduce<Record<string, number>>((acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1
        return acc
      }, {})
      const releaseTrainsByStatus = releaseTrains.reduce<Record<string, number>>((acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1
        return acc
      }, {})
      const atomicTasksByStatus = atomicTasks.reduce<Record<string, number>>((acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1
        return acc
      }, {})
      return { workerbees: beesByStatus, releaseTrains: releaseTrainsByStatus, atomictasks: atomicTasksByStatus }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export function handleMcpToolsList(_req: Request, res: Response) {
  res.json({ tools: TOOLS })
}

export async function handleMcpCall(req: Request, res: Response) {
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
      const result = await callTool(name, toolArgs)
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
