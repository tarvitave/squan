import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('squan', {
  // Server management
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  restartServer: () => ipcRenderer.invoke('restart-server'),

  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // Listen for events from main process
  onServerStatus: (cb: (status: { status: string }) => void) => {
    const handler = (_event: unknown, data: { status: string }) => cb(data)
    ipcRenderer.on('server-status', handler)
    return () => ipcRenderer.removeListener('server-status', handler)
  },

  onSwitchView: (cb: (view: string) => void) => {
    const handler = (_event: unknown, view: string) => cb(view)
    ipcRenderer.on('switch-view', handler)
    return () => ipcRenderer.removeListener('switch-view', handler)
  },

  onToggleCommandPalette: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('toggle-command-palette', handler)
    return () => ipcRenderer.removeListener('toggle-command-palette', handler)
  },

  onToggleSidebar: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('toggle-sidebar', handler)
    return () => ipcRenderer.removeListener('toggle-sidebar', handler)
  },

  onOpenPreferences: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('open-preferences', handler)
    return () => ipcRenderer.removeListener('open-preferences', handler)
  },
})
