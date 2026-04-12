import { useStore } from '../../store/index.js'
import { Button } from '../ui/button.js'
import { Settings, LogOut } from 'lucide-react'

/**
 * Compact account strip — shown at top of sidebar.
 * Full account management is in PreferencesPanel.
 */
export function AccountPanel() {
  const user = useStore((s) => s.user)
  const clearAuth = useStore((s) => s.clearAuth)
  const setShowPreferences = useStore((s) => s.setShowPreferences)

  if (!user) return null

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-light">
      <button
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[10px] text-text-muted hover:text-text transition-colors truncate"
        onClick={() => setShowPreferences(true)}
        title="Preferences"
      >
        <Settings className="w-3 h-3 shrink-0" />
        <span className="truncate">{user.email}</span>
      </button>
      <Button variant="ghost" size="iconSm" onClick={clearAuth} title="Sign out">
        <LogOut className="w-3 h-3 text-text-dim" />
      </Button>
    </div>
  )
}
