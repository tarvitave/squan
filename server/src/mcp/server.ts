/**
 * Squansq MCP Server
 * Exposes orchestration capabilities as MCP tools for AI agents.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST /api/mcp
 * Tool discovery: GET /api/mcp/tools
 */

import type { Request, Response } from 'express'
import { workerBeeManager } from '../polecat/manager.js'
import { convoyManager } from '../convoy/manager.js'
import { beadManager } from '../beads/manager.js'
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
    name: 'list_convoys',
    description: 'List all convoys (work bundles)',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status: open, in_progress, landed, cancelled' } } },
  },
  {
    name: 'create_convoy',
    description: 'Create a new convoy (work bundle) for a project',
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
    name: 'dispatch_convoy',
    description: 'Spawn a WorkerBee and assign it to a convoy. The convoy description becomes the agent\'s task.',
    inputSchema: { type: 'object', required: ['convoyId'], properties: { convoyId: { type: 'string' } } },
  },
  {
    name: 'land_convoy',
    description: 'Mark a convoy as landed (completed)',
    inputSchema: { type: 'object', required: ['convoyId'], properties: { convoyId: { type: 'string' } } },
  },
  {
    name: 'list_beads',
    description: 'List beads (atomic work items)',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        convoyId: { type: 'string' },
      },
    },
  },
  {
    name: 'create_bead',
    description: 'Create a new bead (atomic work item)',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        convoyId: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' }, description: 'Bead IDs this depends on' },
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
      return rigManager.listByTown('default')
    }
    case 'list_convoys': {
      const all = await convoyManager.listAll()
      return args.status ? all.filter((c) => c.status === args.status) : all
    }
    case 'create_convoy': {
      return convoyManager.create(args.name as string, args.projectId as string, [], args.description as string | undefined)
    }
    case 'dispatch_convoy': {
      const convoy = await convoyManager.getById(args.convoyId as string)
      if (!convoy) throw new Error(`Convoy ${args.convoyId} not found`)
      const task = convoy.description || convoy.name
      const bee = await workerBeeManager.spawn(convoy.projectId, task)
      await convoyManager.assignWorkerBee(convoy.id, bee.id)
      return { bee, convoy: await convoyManager.getById(convoy.id) }
    }
    case 'land_convoy': {
      await convoyManager.land(args.convoyId as string)
      return { ok: true }
    }
    case 'list_beads': {
      if (args.convoyId) return beadManager.listByConvoy(args.convoyId as string)
      if (args.projectId) return beadManager.listByProject(args.projectId as string)
      return beadManager.listAll()
    }
    case 'create_bead': {
      const bead = await beadManager.create(
        args.projectId as string,
        args.title as string,
        args.description as string | undefined,
        args.convoyId as string | undefined,
        args.dependsOn as string[] | undefined
      )
      return bead
    }
    case 'list_hooks': {
      if (args.projectId) return hookManager.listByProject(args.projectId as string)
      return hookManager.listAll()
    }
    case 'get_status_summary': {
      const [bees, convoys, beads] = await Promise.all([
        workerBeeManager.listAll(),
        convoyManager.listAll(),
        beadManager.listAll(),
      ])
      const beesByStatus = bees.reduce<Record<string, number>>((acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1
        return acc
      }, {})
      const convoysByStatus = convoys.reduce<Record<string, number>>((acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1
        return acc
      }, {})
      const beadsByStatus = beads.reduce<Record<string, number>>((acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1
        return acc
      }, {})
      return { workerbees: beesByStatus, convoys: convoysByStatus, beads: beadsByStatus }
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
