declare const __APP_VERSION__: string

interface SquanBridge {
  getServerStatus: () => Promise<{ status: string; url: string; port: number }>
  restartServer: () => Promise<{ status: string }>
  getAppInfo: () => Promise<{ version: string; isDev: boolean; platform: string }>
  onServerStatus: (cb: (status: { status: string }) => void) => () => void
  onSwitchView: (cb: (view: string) => void) => () => void
  onToggleCommandPalette: (cb: () => void) => () => void
  onToggleSidebar: (cb: () => void) => () => void
  onOpenPreferences: (cb: () => void) => () => void
}

interface Window {
  squan?: SquanBridge
}
