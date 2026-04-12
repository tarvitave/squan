import * as vscode from 'vscode'
import { eventBus } from '../events'
import { workerBeeManager } from '../managers/workerbee'
import { rootAgentManager } from '../managers/rootagent'
import { rigManager } from '../managers/rig'
import type { WorkerBee, Project } from '../types'

export type MainTreeNode =
  | { kind: 'rootAgent' }
  | { kind: 'project'; project: Project }
  | { kind: 'agent'; bee: WorkerBee }
  | { kind: 'empty'; label: string }

export class MainTreeItem extends vscode.TreeItem {
  constructor(public readonly node: MainTreeNode) {
    super('', vscode.TreeItemCollapsibleState.None)

    switch (node.kind) {
      case 'rootAgent':
        this.label = 'Root Agent'
        this.contextValue = 'rootAgent'
        this.iconPath = new vscode.ThemeIcon('robot')
        this.collapsibleState = vscode.TreeItemCollapsibleState.None
        break

      case 'project':
        this.label = node.project.name
        this.id = `project-${node.project.id}`
        this.description = node.project.localPath
        this.contextValue = 'project'
        this.iconPath = new vscode.ThemeIcon('repo')
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
        this.tooltip = node.project.localPath
        break

      case 'agent': {
        const { bee } = node
        const statusIcon =
          bee.status === 'working' ? '$(sync~spin)' :
          bee.status === 'done'    ? '$(check)' :
          bee.status === 'stalled' ? '$(warning)' :
          bee.status === 'zombie'  ? '$(error)' :
                                     '$(circle-outline)'
        this.label = `${statusIcon} ${bee.name}`
        this.id = bee.id
        this.description = `[${bee.role}] ${bee.status}`
        this.contextValue = 'agent'
        this.iconPath = new vscode.ThemeIcon(
          bee.status === 'working' ? 'sync~spin' :
          bee.status === 'done'    ? 'check' :
          bee.status === 'stalled' ? 'warning' :
          bee.status === 'zombie'  ? 'error' : 'circle-outline'
        )
        this.tooltip = [
          `Name: ${bee.name}`,
          `Role: ${bee.role}`,
          `Status: ${bee.status}`,
          `Branch: ${bee.branch}`,
          bee.taskDescription ? `Task: ${bee.taskDescription.slice(0, 100)}` : '',
          bee.completionNote  ? `Note: ${bee.completionNote.slice(0, 100)}` : '',
        ].filter(Boolean).join('\n')
        if (bee.sessionId) {
          this.command = {
            command: 'squansq.showAgentTerminal',
            title: 'Show Terminal',
            arguments: [bee.id],
          }
        }
        this.collapsibleState = vscode.TreeItemCollapsibleState.None
        break
      }

      case 'empty':
        this.label = node.label
        this.iconPath = new vscode.ThemeIcon('info')
        this.contextValue = 'empty'
        this.collapsibleState = vscode.TreeItemCollapsibleState.None
        break
    }
  }
}

export class MainTreeProvider implements vscode.TreeDataProvider<MainTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MainTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor() {
    eventBus.on('squansq', () => {
      this._onDidChangeTreeData.fire()
    })
  }

  getTreeItem(element: MainTreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: MainTreeItem): Promise<MainTreeItem[]> {
    // --- Root level ---
    if (!element) {
      const items: MainTreeItem[] = []

      // Root Agent node
      try {
        const isRunning = await rootAgentManager.isRunning()
        const item = new MainTreeItem({ kind: 'rootAgent' })
        item.label = isRunning ? 'Root Agent (running)' : 'Root Agent (stopped)'
        item.iconPath = new vscode.ThemeIcon(isRunning ? 'robot' : 'circle-outline')
        item.tooltip = isRunning ? 'Root Agent is running — click Start Root Agent to stop' : 'Root Agent is stopped'
        items.push(item)
      } catch {
        // not yet initialized
      }

      // Projects
      try {
        const projects = await rigManager.listAll()
        if (projects.length === 0) {
          items.push(new MainTreeItem({ kind: 'empty', label: 'No projects — click + to add one' }))
        } else {
          for (const project of projects) {
            items.push(new MainTreeItem({ kind: 'project', project }))
          }
        }
      } catch (err) {
        console.error('[MainTree] Failed to list projects:', err)
      }

      return items
    }

    // --- Children of a project: its agents ---
    if (element.node.kind === 'project') {
      const projectId = element.node.project.id
      try {
        const allBees = await workerBeeManager.listAll()
        const bees = allBees.filter((b) => b.projectId === projectId)
        if (bees.length === 0) {
          return [new MainTreeItem({ kind: 'empty', label: 'No agents' })]
        }
        return bees.map((bee) => new MainTreeItem({ kind: 'agent', bee }))
      } catch (err) {
        console.error('[MainTree] Failed to list agents for project:', err)
        return []
      }
    }

    return []
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }
}
