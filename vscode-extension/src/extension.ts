import * as vscode from 'vscode'
import * as path from 'path'
import { mkdirSync } from 'fs'
import { initDb } from './db'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { VsTerminalManager } from './terminal/manager'
import { setTerminalManager } from './managers/workerbee'
import { setRootAgentTerminalManager, rootAgentManager } from './managers/rootagent'
import { workerBeeManager } from './managers/workerbee'
import { rigManager } from './managers/rig'
import { MainTreeProvider, MainTreeItem } from './ui/mainTreeProvider'
import { AgentTreeItem } from './ui/agentTreeProvider'
import { KanbanPanel } from './ui/kanbanPanel'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[Squansq] Activating...')

  // Ensure global storage directory exists
  mkdirSync(context.globalStoragePath, { recursive: true })

  // Init DB in global storage
  const dbPath = path.join(context.globalStoragePath, 'squansq.db')
  try {
    await initDb(dbPath)
    console.log(`[Squansq] Database initialized at ${dbPath}`)
  } catch (err) {
    vscode.window.showErrorMessage(`Squansq: Failed to initialize database: ${err}`)
    return
  }

  // Start MCP server
  let mcpPort: number
  try {
    mcpPort = await startMcpServer()
    await context.globalState.update('mcpPort', mcpPort)
    console.log(`[Squansq] MCP server started on port ${mcpPort}`)
  } catch (err) {
    vscode.window.showErrorMessage(`Squansq: Failed to start MCP server: ${err}`)
    return
  }

  // Init terminal manager
  const terminalManager = new VsTerminalManager(context)
  setTerminalManager(terminalManager)
  setRootAgentTerminalManager(terminalManager)

  // Register unified tree view
  const mainTreeProvider = new MainTreeProvider()
  const mainTreeView = vscode.window.registerTreeDataProvider('squansq.mainTree', mainTreeProvider)

  // Register commands
  const commands = [
    vscode.commands.registerCommand('squansq.openKanban', () => {
      KanbanPanel.createOrShow(context)
    }),

    vscode.commands.registerCommand('squansq.startRootAgent', async () => {
      try {
        const isRunning = await rootAgentManager.isRunning()
        if (isRunning) {
          const action = await vscode.window.showInformationMessage(
            'Root Agent is already running. Stop it?',
            'Stop',
            'Cancel'
          )
          if (action === 'Stop') {
            await rootAgentManager.stop()
            vscode.window.showInformationMessage('Root Agent stopped.')
            mainTreeProvider.refresh()
          }
          return
        }

        // Use first workspace folder as working directory
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        if (!workspacePath) {
          const pick = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            openLabel: 'Select workspace for Root Agent',
          })
          if (!pick?.[0]) return
          await rootAgentManager.start(mcpPort, pick[0].fsPath)
        } else {
          await rootAgentManager.start(mcpPort, workspacePath)
        }

        mainTreeProvider.refresh()
        vscode.window.showInformationMessage('Root Agent started.')
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to start Root Agent: ${err}`)
      }
    }),

    vscode.commands.registerCommand('squansq.addProject', async () => {
      const pick = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: 'Select project folder',
      })
      if (!pick?.[0]) return

      const localPath = pick[0].fsPath
      const defaultName = path.basename(localPath)
      const name = await vscode.window.showInputBox({
        prompt: 'Project name',
        value: defaultName,
        placeHolder: 'my-project',
      })
      if (!name) return

      try {
        const project = await rigManager.add(name, localPath, localPath)

        // Write .mcp.json to the project directory so agents can find the MCP server
        const mcpConfig = {
          mcpServers: {
            squansq: {
              type: 'http',
              url: `http://127.0.0.1:${mcpPort}/mcp`,
            },
          },
        }
        const { writeFileSync } = require('fs') as typeof import('fs')
        const mcpJsonPath = path.join(localPath, '.mcp.json')
        writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf8')

        mainTreeProvider.refresh()
        vscode.window.showInformationMessage(
          `Project "${name}" added (id: ${project.id}). MCP config written to ${mcpJsonPath}`
        )
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to add project: ${err}`)
      }
    }),

    vscode.commands.registerCommand('squansq.copyMcpUrl', async () => {
      const url = `http://127.0.0.1:${mcpPort}/mcp`
      await vscode.env.clipboard.writeText(url)
      vscode.window.showInformationMessage(`MCP URL copied: ${url}`)
    }),

    vscode.commands.registerCommand('squansq.killAgent', async (item: AgentTreeItem | string) => {
      const workerBeeId = typeof item === 'string' ? item : item?.workerBeeId
      if (!workerBeeId) {
        vscode.window.showWarningMessage('No agent selected.')
        return
      }

      const bee = await workerBeeManager.getById(workerBeeId)
      if (!bee) {
        vscode.window.showWarningMessage('Agent not found.')
        return
      }

      const confirm = await vscode.window.showWarningMessage(
        `Kill agent "${bee.name}"?`,
        { modal: true },
        'Kill'
      )
      if (confirm !== 'Kill') return

      try {
        await workerBeeManager.nuke(workerBeeId)
        mainTreeProvider.refresh()
        vscode.window.showInformationMessage(`Agent "${bee.name}" killed.`)
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to kill agent: ${err}`)
      }
    }),

    vscode.commands.registerCommand('squansq.showAgentTerminal', (workerBeeId: string) => {
      // Find the terminal by worker bee's session ID
      workerBeeManager.getById(workerBeeId).then((bee) => {
        if (!bee?.sessionId) {
          vscode.window.showWarningMessage('No terminal for this agent.')
          return
        }
        terminalManager.show(bee.sessionId)
      }).catch(console.error)
    }),

    vscode.commands.registerCommand('squansq.refreshAgentTree', () => {
      mainTreeProvider.refresh()
    }),
  ]

  context.subscriptions.push(
    ...commands,
    mainTreeView,
    terminalManager,
    { dispose: stopMcpServer },
  )

  vscode.window.showInformationMessage(`Squansq ready — MCP on port ${mcpPort}`)
  console.log(`[Squansq] Activated. MCP port: ${mcpPort}`)
}

export function deactivate(): void {
  stopMcpServer()
  console.log('[Squansq] Deactivated.')
}

