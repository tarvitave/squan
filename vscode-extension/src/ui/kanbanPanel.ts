import * as vscode from 'vscode'
import { eventBus } from '../events'
import { workerBeeManager } from '../managers/workerbee'
import { releaseTrainManager } from '../managers/releasetrain'
import { atomicTaskManager } from '../managers/atomictask'
import { rigManager } from '../managers/rig'
import type { SquansqEvent } from '../types'

export class KanbanPanel {
  public static currentPanel: KanbanPanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private readonly _context: vscode.ExtensionContext
  private _disposables: vscode.Disposable[] = []

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel
    this._context = context

    this._panel.webview.html = this._getHtml()

    // Send initial state snapshot
    this._sendSnapshot().catch(console.error)

    // Forward events to webview
    const eventHandler = (event: SquansqEvent) => {
      this._panel.webview.postMessage({ type: 'event', event })
    }
    eventBus.on('squansq', eventHandler)
    this._disposables.push({
      dispose: () => eventBus.off('squansq', eventHandler),
    })

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      null,
      this._disposables
    )

    // Cleanup on close
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
  }

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    if (KanbanPanel.currentPanel) {
      KanbanPanel.currentPanel._panel.reveal(column)
      KanbanPanel.currentPanel._sendSnapshot().catch(console.error)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'squansq.kanban',
      'Squansq Kanban',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    )

    KanbanPanel.currentPanel = new KanbanPanel(panel, context)
  }

  private async _sendSnapshot(): Promise<void> {
    try {
      const [projects, bees, releaseTrains, atomicTasks] = await Promise.all([
        rigManager.listAll(),
        workerBeeManager.listAll(),
        releaseTrainManager.listAll(),
        atomicTaskManager.listAll(),
      ])
      this._panel.webview.postMessage({
        type: 'snapshot',
        data: { projects, workerbees: bees, releaseTrains, atomicTasks },
      })
    } catch (err) {
      console.error('[Kanban] Failed to send snapshot:', err)
    }
  }

  private async _handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
    try {
      switch (message.command) {
        case 'refresh':
          await this._sendSnapshot()
          break
        case 'dispatch_release_train': {
          const rt = await releaseTrainManager.getById(message.releaseTrainId as string)
          if (!rt) break
          const task = rt.description || rt.name
          const bee = await workerBeeManager.spawn(rt.projectId, task)
          await releaseTrainManager.assignWorkerBee(rt.id, bee.id)
          await this._sendSnapshot()
          break
        }
        case 'land_release_train': {
          await releaseTrainManager.land(message.releaseTrainId as string)
          break
        }
        case 'cancel_release_train': {
          await releaseTrainManager.cancel(message.releaseTrainId as string)
          break
        }
        case 'kill_workerbee': {
          await workerBeeManager.nuke(message.workerBeeId as string)
          break
        }
        case 'create_release_train': {
          await releaseTrainManager.create(
            message.name as string,
            message.projectId as string,
            [],
            message.description as string | undefined
          )
          await this._sendSnapshot()
          break
        }
        case 'show_terminal': {
          vscode.commands.executeCommand('squansq.showAgentTerminal', message.workerBeeId)
          break
        }
        default:
          console.warn(`[Kanban] Unknown command: ${message.command}`)
      }
    } catch (err) {
      console.error('[Kanban] Message handler error:', err)
      this._panel.webview.postMessage({ type: 'error', message: (err as Error).message })
    }
  }

  public dispose(): void {
    KanbanPanel.currentPanel = undefined
    this._panel.dispose()
    for (const d of this._disposables) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Squansq Kanban</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-shrink: 0;
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    button {
      padding: 4px 10px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }

    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .btn-danger {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-errorForeground, #f48771);
      border-color: var(--vscode-inputValidation-errorBorder, #be1100);
    }
    .btn-danger:hover { opacity: 0.8; }

    .btn-small {
      padding: 2px 6px;
      font-size: 11px;
    }

    .board {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      flex: 1;
      overflow: hidden;
    }

    .column {
      display: flex;
      flex-direction: column;
      background: var(--vscode-sideBar-background, rgba(255,255,255,0.03));
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      border-radius: 6px;
      overflow: hidden;
    }

    .column-header {
      padding: 10px 12px;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .column-header .count {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      padding: 1px 7px;
      font-size: 11px;
    }

    .column-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      border-radius: 4px;
      padding: 10px;
    }

    .card-title {
      font-weight: 500;
      font-size: 13px;
      margin-bottom: 4px;
      word-break: break-word;
    }

    .card-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }

    .card-tasks {
      margin: 6px 0;
    }

    .task-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      padding: 2px 0;
      color: var(--vscode-descriptionForeground);
    }

    .task-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .task-dot.open { background: var(--vscode-descriptionForeground); }
    .task-dot.in_progress { background: var(--vscode-charts-blue, #4fc3f7); }
    .task-dot.done { background: var(--vscode-charts-green, #81c784); }
    .task-dot.blocked { background: var(--vscode-charts-red, #ef5350); }
    .task-dot.assigned { background: var(--vscode-charts-yellow, #ffb74d); }

    .card-actions {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 500;
    }

    .badge-status-idle      { background: rgba(128,128,128,0.2); }
    .badge-status-working   { background: rgba(79,195,247,0.2); color: #4fc3f7; }
    .badge-status-done      { background: rgba(129,199,132,0.2); color: #81c784; }
    .badge-status-stalled   { background: rgba(255,183,77,0.2); color: #ffb74d; }
    .badge-status-zombie    { background: rgba(239,83,80,0.2); color: #ef5350; }

    .badge-role {
      background: rgba(128,128,128,0.15);
      color: var(--vscode-descriptionForeground);
    }

    .agent-section {
      margin-top: 4px;
      padding: 4px 6px;
      background: rgba(128,128,128,0.08);
      border-radius: 3px;
      font-size: 11px;
    }

    .agent-name {
      font-weight: 500;
      color: var(--vscode-foreground);
    }

    .completion-note {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      margin-top: 4px;
      word-break: break-word;
    }

    .empty-state {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      padding: 24px 8px;
    }

    .pr-link {
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .pr-link:hover { text-decoration: underline; }

    .section-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }

    #create-dialog {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    #create-dialog.open { display: flex; }

    .dialog-box {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 20px;
      width: 480px;
      max-width: 90vw;
    }

    .dialog-box h2 {
      font-size: 15px;
      margin-bottom: 14px;
    }

    .form-group {
      margin-bottom: 12px;
    }

    label {
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }

    input, select, textarea {
      width: 100%;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
      border-radius: 3px;
      font-family: inherit;
      font-size: 13px;
    }

    textarea { resize: vertical; min-height: 80px; }

    .dialog-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <header>
    <h1>Squansq Kanban</h1>
    <div class="header-actions">
      <button class="btn-secondary" onclick="refresh()">Refresh</button>
      <button class="btn-primary" onclick="openCreateDialog()">+ Release Train</button>
    </div>
  </header>

  <div class="board">
    <div class="column">
      <div class="column-header">
        Open
        <span class="count" id="count-open">0</span>
      </div>
      <div class="column-body" id="col-open"></div>
    </div>
    <div class="column">
      <div class="column-header">
        In Progress
        <span class="count" id="count-in_progress">0</span>
      </div>
      <div class="column-body" id="col-in_progress"></div>
    </div>
    <div class="column">
      <div class="column-header">
        Landed
        <span class="count" id="count-landed">0</span>
      </div>
      <div class="column-body" id="col-landed"></div>
    </div>
  </div>

  <div id="create-dialog">
    <div class="dialog-box">
      <h2>Create Release Train</h2>
      <div class="form-group">
        <label for="rt-project">Project</label>
        <select id="rt-project"></select>
      </div>
      <div class="form-group">
        <label for="rt-name">Name</label>
        <input type="text" id="rt-name" placeholder="e.g. feat/add-dark-mode" />
      </div>
      <div class="form-group">
        <label for="rt-description">Task Description (becomes CLAUDE.md)</label>
        <textarea id="rt-description" placeholder="Detailed task for the agent..."></textarea>
      </div>
      <div class="dialog-actions">
        <button class="btn-secondary" onclick="closeCreateDialog()">Cancel</button>
        <button class="btn-primary" onclick="submitCreate()">Create</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let state = { projects: [], workerbees: [], releaseTrains: [], atomicTasks: [] };

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'snapshot') {
        state = msg.data;
        render();
      } else if (msg.type === 'event') {
        // For most events, just refresh
        vscode.postMessage({ command: 'refresh' });
      } else if (msg.type === 'error') {
        console.error('Server error:', msg.message);
      }
    });

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function render() {
      const cols = { open: [], in_progress: [], landed: [], cancelled: [] };
      for (const rt of state.releaseTrains) {
        const col = cols[rt.status] ?? cols.open;
        col.push(rt);
      }

      for (const status of ['open', 'in_progress', 'landed']) {
        const el = document.getElementById('col-' + status);
        const count = document.getElementById('count-' + status);
        if (!el) continue;

        count.textContent = cols[status].length;

        if (cols[status].length === 0) {
          el.innerHTML = '<div class="empty-state">No release trains</div>';
          continue;
        }

        el.innerHTML = cols[status].map(rt => renderCard(rt)).join('');
      }

      // Update project select
      const sel = document.getElementById('rt-project');
      if (sel && state.projects.length > 0) {
        sel.innerHTML = state.projects.map(p =>
          '<option value="' + p.id + '">' + escHtml(p.name) + '</option>'
        ).join('');
      }
    }

    function renderCard(rt) {
      const tasks = state.atomicTasks.filter(t => t.releaseTrainId === rt.id);
      const bee = rt.assignedWorkerBeeId
        ? state.workerbees.find(b => b.id === rt.assignedWorkerBeeId)
        : null;
      const project = state.projects.find(p => p.id === rt.projectId);

      let actionsHtml = '';
      if (rt.status === 'open') {
        actionsHtml += '<button class="btn-primary btn-small" onclick="dispatch(\\''+rt.id+'\\')">Dispatch</button>';
        actionsHtml += '<button class="btn-danger btn-small" onclick="cancel(\\''+rt.id+'\\')">Cancel</button>';
      } else if (rt.status === 'in_progress') {
        actionsHtml += '<button class="btn-secondary btn-small" onclick="land(\\''+rt.id+'\\')">Land</button>';
        if (bee) {
          actionsHtml += '<button class="btn-danger btn-small" onclick="killBee(\\''+bee.id+'\\')">Kill Agent</button>';
        }
      }

      const tasksHtml = tasks.length > 0
        ? '<div class="card-tasks">' +
            tasks.map(t =>
              '<div class="task-item"><div class="task-dot ' + t.status + '"></div>' +
              escHtml(t.title) + '</div>'
            ).join('') +
          '</div>'
        : '';

      const agentHtml = bee
        ? '<div class="agent-section">' +
            '<span class="agent-name">' + escHtml(bee.name) + '</span> ' +
            '<span class="badge badge-status-' + bee.status + '">' + bee.status + '</span> ' +
            '<span class="badge badge-role">' + (bee.role || 'coder') + '</span>' +
            (bee.completionNote ? '<div class="completion-note">' + escHtml(bee.completionNote.slice(0, 100)) + '</div>' : '') +
          '</div>'
        : '';

      const prHtml = rt.prUrl
        ? '<div><a class="pr-link" href="' + rt.prUrl + '">#' + rt.prNumber + ' PR</a></div>'
        : '';

      return '<div class="card">' +
        '<div class="card-title">' + escHtml(rt.name) + '</div>' +
        '<div class="card-meta">' + (project ? escHtml(project.name) : '') + '</div>' +
        tasksHtml +
        agentHtml +
        prHtml +
        (actionsHtml ? '<div class="card-actions">' + actionsHtml + '</div>' : '') +
      '</div>';
    }

    function dispatch(id) {
      vscode.postMessage({ command: 'dispatch_release_train', releaseTrainId: id });
    }

    function land(id) {
      vscode.postMessage({ command: 'land_release_train', releaseTrainId: id });
    }

    function cancel(id) {
      vscode.postMessage({ command: 'cancel_release_train', releaseTrainId: id });
    }

    function killBee(id) {
      vscode.postMessage({ command: 'kill_workerbee', workerBeeId: id });
    }

    function openCreateDialog() {
      document.getElementById('create-dialog').classList.add('open');
    }

    function closeCreateDialog() {
      document.getElementById('create-dialog').classList.remove('open');
    }

    function submitCreate() {
      const projectId = document.getElementById('rt-project').value;
      const name = document.getElementById('rt-name').value.trim();
      const description = document.getElementById('rt-description').value.trim();
      if (!name || !projectId) return;
      vscode.postMessage({ command: 'create_release_train', projectId, name, description });
      document.getElementById('rt-name').value = '';
      document.getElementById('rt-description').value = '';
      closeCreateDialog();
    }

    function escHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`
  }
}
