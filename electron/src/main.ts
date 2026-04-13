// Handle Squirrel startup events (Windows installer)
if (process.platform === 'win32') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (require('electron-squirrel-startup')) {
      process.exit(0)
    }
  } catch { /* not installed in dev mode */ }
}

import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, dialog } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { createServer } from 'http'

// ── Paths ────────────────────────────────────────────────────────────

const isDev = !app.isPackaged

// In dev with electron-forge, __dirname is .vite/build/
// Go up to project root from .vite/build/
const PROJECT_ROOT = isDev ? resolve(__dirname, '../..') : resolve(process.resourcesPath!, '..')

function getServerEntry(): string {
  if (isDev) {
    return join(PROJECT_ROOT, 'server', 'dist', 'index.js')
  }
  // Packaged: extraResource puts dist-server/ into resources/
  return join(process.resourcesPath!, 'dist-server', 'dist', 'index.js')
}

function getServerCwd(): string {
  if (isDev) {
    return join(PROJECT_ROOT, 'server')
  }
  return join(process.resourcesPath!, 'dist-server')
}

function getClientDir(): string {
  if (isDev) {
    return join(PROJECT_ROOT, 'client', 'dist')
  }
  // Packaged: extraResource puts client/dist/ into resources/
  return join(process.resourcesPath!, 'dist')
}

// ── State ────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let serverProcess: ChildProcess | null = null
let serverReady = false
const SERVER_PORT = 3001
const SERVER_URL = `http://localhost:${SERVER_PORT}`

// ── Server Management ────────────────────────────────────────────────

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(true))
    s.once('listening', () => { s.close(); resolve(false) })
    s.listen(port)
  })
}

async function startServer(): Promise<void> {
  const inUse = await isPortInUse(SERVER_PORT)
  if (inUse) {
    console.log(`[squan] Port ${SERVER_PORT} in use — connecting to existing server`)
    serverReady = true
    updateTray()
    return
  }

  const entry = getServerEntry()
  if (!existsSync(entry)) {
    console.error(`[squan] Server not found: ${entry}`)
    dialog.showErrorBox('Squan', `Server not found:\n${entry}\n\nRun "npm run build" first.`)
    return
  }

  const clientDir = getClientDir()
  const serverCwd = getServerCwd()
  console.log(`[squan] Starting server: ${entry}`)
  console.log(`[squan] Server cwd: ${serverCwd}`)
  console.log(`[squan] Client dir: ${clientDir}`)
  console.log(`[squan] File exists: ${existsSync(entry)}`)

  // Use spawn with node — Electron's process.execPath is electron.exe, not node
  // process.env.PATH should still have node; if not, try common locations
  const nodeExe = 'node'
  console.log(`[squan] Using node: ${nodeExe}`)
  console.log(`[squan] PATH includes nodejs:`, (process.env.PATH ?? '').includes('nodejs'))

  serverProcess = spawn(nodeExe, [entry], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      SQUAN_EMBEDDED: 'true',
      SQUAN_CLIENT_DIR: clientDir,
      NODE_ENV: isDev ? 'development' : 'production',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  serverProcess.stdout?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[server] ${msg}`)
    if (msg.includes('http://localhost:') && !serverReady) {
      serverReady = true
      updateTray()
      mainWindow?.webContents.send('server-status', { status: 'online' })
    }
  })

  serverProcess.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.error(`[server:err] ${msg}`)
  })

  serverProcess.on('error', (err) => {
    console.error(`[squan] Failed to start server:`, err.message)
  })

  serverProcess.on('exit', (code) => {
    console.log(`[squan] Server exited (code ${code})`)
    serverReady = false
    serverProcess = null
    updateTray()
    mainWindow?.webContents.send('server-status', { status: 'offline' })
  })

  // Poll health endpoint until ready
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(`${SERVER_URL}/api/health`)
      if (res.ok) {
        serverReady = true
        updateTray()
        console.log('[squan] Server ready')
        return
      }
    } catch { /* not ready */ }
  }
  console.error('[squan] Server failed to start in 15s')
}

function stopServer() {
  if (serverProcess) {
    const pid = serverProcess.pid
    try {
      // On Windows, SIGTERM doesn't work — kill the process tree
      if (process.platform === 'win32' && pid) {
        require('child_process').execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' })
      } else {
        serverProcess.kill('SIGTERM')
      }
    } catch { /* ignore — process may already be dead */ }
    serverProcess = null
    serverReady = false
    updateTray()
  }
}

// ── Window ───────────────────────────────────────────────────────────

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string | undefined

function createWindow() {
  // Load icon — works in both dev and packaged mode
  const iconPath = isDev
    ? join(PROJECT_ROOT, 'assets', 'icon.ico')
    : join(process.resourcesPath!, 'icon.ico')
  const windowIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Squan',
    icon: windowIcon,
    backgroundColor: '#f4f6f7',
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#f4f6f7',
      symbolColor: '#3f434b',
      height: 32,
    } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  // Force sidebar visible by patching persisted state before page renders
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(`
      try {
        const raw = localStorage.getItem('squansq-ui');
        if (raw) {
          const data = JSON.parse(raw);
          if (data.state && data.state.ui) {
            data.state.ui.sidebarCollapsed = false;
            localStorage.setItem('squansq-ui', JSON.stringify(data));
          }
        }
      } catch(e) {}
    `)
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && !isDev) {
    // electron-forge production mode
    mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  } else if (serverReady) {
    // Load from embedded server (serves both API + client static files)
    console.log(`[squan] Loading from embedded server: ${SERVER_URL}`)
    mainWindow.loadURL(SERVER_URL)
  } else {
    // Server not ready yet, try anyway
    console.log(`[squan] Loading from embedded server (may not be ready): ${SERVER_URL}`)
    mainWindow.loadURL(SERVER_URL)
  }

  // Only open DevTools if explicitly requested (set SQUAN_DEVTOOLS=1)
  if (process.env.SQUAN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── Tray ─────────────────────────────────────────────────────────────

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgklEQVQ4T2NkoBAwUqifYdAY8B8E/v9nYGBgZCQYBKgGMIIcgOIKJBcwMjIyILsCpwEoYYDsBpwGYHMFsgtwGUDIFTgNIORVnAYQ8ipOA3B5lawwwBsGxIQiXgPweRWvAfi8itcAfF4laACqV/EaQMireA0g5FW8BhDyKsEkStAAABBrMBEHiNBQAAAAAElFTkSuQmCC'
  )
  tray = new Tray(icon)
  updateTray()
}

function updateTray() {
  if (!tray) return
  const label = serverReady ? '● Server Online' : '○ Server Offline'
  tray.setToolTip(`Squan — ${label}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Squan', enabled: false },
    { type: 'separator' },
    { label, enabled: false },
    { type: 'separator' },
    { label: 'Show Window', click: () => { mainWindow ? (mainWindow.show(), mainWindow.focus()) : createWindow() } },
    { label: serverReady ? 'Restart Server' : 'Start Server', click: async () => { stopServer(); await startServer() } },
    { type: 'separator' },
    { label: 'Open in Browser', click: () => shell.openExternal(SERVER_URL) },
    { type: 'separator' },
    { label: 'Quit', click: () => { stopServer(); app.quit() } },
  ]))
  tray.on('click', () => { mainWindow ? (mainWindow.show(), mainWindow.focus()) : createWindow() })
}

// ── Menu ─────────────────────────────────────────────────────────────

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Squan',
      submenu: [
        { label: 'About Squan', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('open-preferences') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { stopServer(); app.quit() } },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        ...['Terminals', 'Kanban', 'Metrics', 'Events', 'Costs', 'Console', 'Claude Code'].map((label, i) => ({
          label, accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => mainWindow?.webContents.send('switch-view', ['terminals', 'kanban', 'metrics', 'events', 'costs', 'console', 'claudecode'][i]),
        })),
        { type: 'separator' as const },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: () => mainWindow?.webContents.send('toggle-command-palette') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('toggle-sidebar') },
        { type: 'separator' as const },
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { role: 'resetZoom' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
    { label: 'Help', submenu: [
      { label: 'Documentation', click: () => shell.openExternal('https://squansq.com/docs') },
      { label: 'GitHub', click: () => shell.openExternal('https://github.com/tarvitave/squansq') },
      { type: 'separator' },
      { label: 'Author: Colin', enabled: false },
      { label: 'Visit squansq.com', click: () => shell.openExternal('https://squansq.com') },
      { type: 'separator' },
      { label: `Squan v${app.getVersion()}`, enabled: false },
    ]},
  ]))
}

// ── IPC ──────────────────────────────────────────────────────────────

function setupIpc() {
  ipcMain.handle('get-server-status', () => ({ status: serverReady ? 'online' : 'offline', url: SERVER_URL, port: SERVER_PORT }))
  ipcMain.handle('restart-server', async () => { stopServer(); await startServer(); return { status: serverReady ? 'online' : 'offline' } })
  ipcMain.handle('get-app-info', () => ({ version: app.getVersion(), isDev, platform: process.platform }))
}

// ── Lifecycle ────────────────────────────────────────────────────────

// Fix cache permission errors when running from read-only directories
if (!isDev) {
  const { join } = require('path')
  const userDataPath = join(app.getPath('appData'), 'Squan')
  app.setPath('userData', userDataPath)
}

app.whenReady().then(async () => {
  console.log('[squan] App ready')
  console.log('[squan] isDev:', isDev)
  console.log('[squan] __dirname:', __dirname)
  console.log('[squan] PROJECT_ROOT:', PROJECT_ROOT)
  console.log('[squan] getAppPath:', app.getAppPath())
  console.log('[squan] server entry:', getServerEntry())
  console.log('[squan] server exists:', existsSync(getServerEntry()))

  try {
    setupIpc()
    createMenu()
    // Skip tray in dev to avoid crash
    try { createTray() } catch (e) { console.error('[squan] Tray error:', e) }
    await startServer()
    createWindow()
  } catch (err) {
    console.error('[squan] Fatal error during startup:', err)
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') { stopServer(); app.quit() } })
app.on('activate', () => { if (!mainWindow) createWindow() })
app.on('before-quit', () => stopServer())
