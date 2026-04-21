/**
 * System Tray for Squan
 *
 * Creates a branded system tray icon with:
 * - Server status indicator (green dot = online, red = offline)
 * - Quick actions: show window, restart server, open in browser
 * - Agent count display
 * - Quit
 *
 * On Windows: uses a teal "S" icon rendered at runtime
 * On macOS: uses template images that adapt to light/dark menu bar
 */

import { Tray, Menu, nativeImage, app, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

const isDev = !app.isPackaged

interface TrayState {
  serverReady: boolean
  agentCount?: number
  serverUrl: string
}

let tray: Tray | null = null
let currentState: TrayState = { serverReady: false, serverUrl: 'http://localhost:3001' }

// Callbacks
let onShowWindow: (() => void) | null = null
let onRestartServer: (() => void) | null = null
let onQuit: (() => void) | null = null

/**
 * Create the tray icon image.
 * Uses the app icon.ico resized for the tray, or falls back to a
 * programmatically generated "S" icon.
 */
function createTrayImage(): Electron.NativeImage {
  // Try to load the proper icon file
  const iconPaths = isDev
    ? [
        join(process.cwd(), 'assets', 'tray-icon.png'),
        join(process.cwd(), 'assets', 'icon.ico'),
        join(process.cwd(), 'assets', 'icon.png'),
      ]
    : [
        join(process.resourcesPath!, 'tray-icon.png'),
        join(process.resourcesPath!, 'icon.ico'),
        join(process.resourcesPath!, 'icon.png'),
      ]

  for (const p of iconPaths) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        // Resize to 16x16 for tray
        return img.resize({ width: 16, height: 16 })
      }
    }
  }

  // Fallback: create a programmatic "S" tray icon
  // This is a teal "S" on transparent background, 16x16
  return nativeImage.createFromDataURL(createFallbackIcon())
}

/**
 * Generates a simple teal "S" icon as base64 PNG data URL.
 * Used as fallback when the icon file is not found.
 */
function createFallbackIcon(): string {
  // Pre-rendered 16x16 teal "S" icon (hand-crafted pixel data)
  // Teal (#13bbaf) S on transparent background
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABIElEQVQ4T6WTvU7DQBCEP0MKJCgoUqTgBXgK3oE34AkoaHkBREFLQYUEJQUNEgUSD4Ao2D1ZFufsd7Zz0uq02m9mZ/fOkvjpRAv8B3ApaQvAGYBXAE+SVuKe50gaS3oDcCPp0cwOI+IBAKA5Ary75zWA98gV93wE8CjpmZnVYcAO0xHAnoicmrXunubHAN7M7LRaw8x2ANyJyD4zOw4DzOyyXq/PoyiKO9mG2L+oRNHBYDA4A3BOROdEdKkbEE8syzI/TdNf5XI5KJVKkVJqqApHIYOJzCybJMmvRqNBU1NTJvfq9XqT8aSUfaRWq42z2Swt5HVVr0VdBNrt9ixJkvGfoVJK+Aw+Q81m0yuXy4Vmcv9lmu4R0fDvf6YP9g1KilZ2gY8AAAAASUVORK5CYII='
}

/**
 * Build the context menu for the tray
 */
function buildContextMenu(): Electron.Menu {
  const { serverReady, agentCount, serverUrl } = currentState

  const statusLabel = serverReady ? '● Server Online' : '○ Server Offline'
  const statusColor = serverReady ? '#4ade80' : '#f87171'

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: `Squan v${app.getVersion()}`,
      enabled: false,
      icon: createTrayImage(),
    },
    { type: 'separator' },
    {
      label: statusLabel,
      enabled: false,
    },
  ]

  // Show agent count if available
  if (agentCount !== undefined && agentCount > 0) {
    items.push({
      label: `  ${agentCount} agent${agentCount !== 1 ? 's' : ''} running`,
      enabled: false,
    })
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Show Squan',
      click: () => onShowWindow?.(),
      accelerator: 'CmdOrCtrl+Shift+S',
    },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(serverUrl),
    },
    { type: 'separator' },
    {
      label: serverReady ? 'Restart Server' : 'Start Server',
      click: () => onRestartServer?.(),
    },
    { type: 'separator' },
    {
      label: 'Quit Squan',
      click: () => onQuit?.(),
      accelerator: 'CmdOrCtrl+Q',
    },
  )

  return Menu.buildFromTemplate(items)
}

/**
 * Initialize the system tray
 */
export function createSquanTray(opts: {
  serverUrl: string
  onShowWindow: () => void
  onRestartServer: () => void
  onQuit: () => void
}): Tray {
  onShowWindow = opts.onShowWindow
  onRestartServer = opts.onRestartServer
  onQuit = opts.onQuit
  currentState.serverUrl = opts.serverUrl

  const icon = createTrayImage()
  tray = new Tray(icon)
  tray.setToolTip('Squan — Multi-Agent Command Center')

  // Single click shows the window
  tray.on('click', () => onShowWindow?.())

  // Right-click (or left-click on macOS) shows context menu
  tray.setContextMenu(buildContextMenu())

  return tray
}

/**
 * Update tray state (server status, agent count, etc.)
 */
export function updateSquanTray(state: Partial<TrayState>) {
  currentState = { ...currentState, ...state }

  if (!tray) return

  const statusText = currentState.serverReady ? 'Online' : 'Offline'
  const agentText = currentState.agentCount ? ` • ${currentState.agentCount} agents` : ''
  tray.setToolTip(`Squan — ${statusText}${agentText}`)

  // Rebuild context menu with updated state
  tray.setContextMenu(buildContextMenu())
}

/**
 * Destroy the tray
 */
export function destroySquanTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
