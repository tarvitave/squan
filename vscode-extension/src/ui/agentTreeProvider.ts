import * as vscode from 'vscode'
import { eventBus } from '../events'
import { workerBeeManager } from '../managers/workerbee'
import { rootAgentManager } from '../managers/rootagent'
import type { WorkerBee, MayorLee } from '../types'

const STATUS_ICONS: Record<string, string> = {
  idle:    '$(circle-outline)',
  working: '$(sync~spin)',
  stalled: '$(warning)',
  zombie:  '$(error)',
  done:    '$(check)',
}

export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly workerBeeId?: string,
    public readonly sessionId?: string | null,
    public readonly status?: string
  ) {
    super(label, collapsibleState)

    if (workerBeeId) {
      this.contextValue = 'agent'
      this.id = workerBeeId
      this.iconPath = new vscode.ThemeIcon(
        status === 'working' ? 'sync~spin'
        : status === 'done' ? 'check'
        : status === 'stalled' ? 'warning'
        : status === 'zombie' ? 'error'
        : 'circle-outline'
      )
      this.tooltip = `Status: ${status ?? 'unknown'}`
      if (sessionId) {
        this.command = {
          command: 'squansq.showAgentTerminal',
          title: 'Show Terminal',
          arguments: [workerBeeId],
        }
      }
    } else {
      // Root agent node
      this.contextValue = 'rootAgent'
      this.iconPath = new vscode.ThemeIcon('robot')
    }
  }
}

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor() {
    // Subscribe to events and refresh the tree
    eventBus.on('squansq', (event) => {
      const agentEvents = [
        'workerbee.spawned',
        'workerbee.working',
        'workerbee.done',
        'workerbee.stalled',
        'workerbee.zombie',
        'workerbee.deleted',
        'rootagent.started',
        'rootagent.stopped',
      ]
      if (agentEvents.includes(event.type)) {
        this._onDidChangeTreeData.fire()
      }
    })
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
    if (element) {
      // No children for individual agents
      return []
    }

    // Root level: show root agent + all worker bees
    const items: AgentTreeItem[] = []

    // Root Agent node
    try {
      const mayor = await rootAgentManager.get()
      const isRunning = await rootAgentManager.isRunning()
      const rootLabel = isRunning
        ? `$(sync~spin) Root Agent (running)`
        : `Root Agent (stopped)`
      const rootItem = new AgentTreeItem(
        rootLabel,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        mayor?.sessionId,
        isRunning ? 'working' : 'idle'
      )
      rootItem.contextValue = 'rootAgent'
      rootItem.iconPath = new vscode.ThemeIcon(isRunning ? 'robot' : 'circle-outline')
      rootItem.tooltip = isRunning ? 'Root Agent is running' : 'Root Agent is stopped'
      items.push(rootItem)
    } catch {
      // Root agent not yet initialized
    }

    // Worker bees
    try {
      const bees = await workerBeeManager.listAll()
      for (const bee of bees) {
        const statusIcon = STATUS_ICONS[bee.status] ?? '$(circle-outline)'
        const label = `${statusIcon} ${bee.name} [${bee.role}]`
        const item = new AgentTreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          bee.id,
          bee.sessionId,
          bee.status
        )
        item.description = bee.status
        item.tooltip = [
          `Name: ${bee.name}`,
          `Role: ${bee.role}`,
          `Status: ${bee.status}`,
          `Branch: ${bee.branch}`,
          bee.taskDescription ? `Task: ${bee.taskDescription.slice(0, 80)}` : '',
          bee.completionNote ? `Note: ${bee.completionNote.slice(0, 80)}` : '',
        ].filter(Boolean).join('\n')
        items.push(item)
      }
    } catch (err) {
      console.error('[AgentTree] Failed to list bees:', err)
    }

    if (items.length === 0) {
      const empty = new AgentTreeItem(
        'No agents running',
        vscode.TreeItemCollapsibleState.None
      )
      empty.iconPath = new vscode.ThemeIcon('info')
      items.push(empty)
    }

    return items
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }
}

// Re-export WorkerBee for use in commands
export type { WorkerBee, MayorLee }
