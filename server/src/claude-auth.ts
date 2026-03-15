import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, copyFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Pre-writes Claude Code auth config so claude starts without showing the
 * interactive login prompt. Handles two config locations:
 *   ~/.claude/settings.json  — older Claude Code versions
 *   ~/.claude.json           — newer Claude Code versions
 *
 * Also restores ~/.claude.json from backup if it's missing (e.g. after a
 * Docker container restart wipes files outside the mounted ~/.claude/ volume).
 *
 * Safe to call multiple times — merges with existing config.
 */
export function preconfigureClaudeAuth(apiKey: string): void {
  try {
    const home = homedir()
    const claudeDir = join(home, '.claude')
    mkdirSync(claudeDir, { recursive: true })

    // Write ~/.claude/settings.json (older Claude Code)
    const settingsPath = join(claudeDir, 'settings.json')
    let existingSettings: Record<string, unknown> = {}
    if (existsSync(settingsPath)) {
      try { existingSettings = JSON.parse(readFileSync(settingsPath, 'utf8')) } catch { /* ignore */ }
    }
    writeFileSync(settingsPath, JSON.stringify({ ...existingSettings, primaryApiKey: apiKey }, null, 2))

    // Write ~/.claude.json (newer Claude Code)
    const claudeJsonPath = join(home, '.claude.json')
    let existingJson: Record<string, unknown> = {}
    if (existsSync(claudeJsonPath)) {
      try { existingJson = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) } catch { /* ignore */ }
    } else {
      // ~/.claude.json is outside the Docker volume — restore from backup if available
      existingJson = restoreFromBackup(claudeDir) ?? {}
    }
    writeFileSync(claudeJsonPath, JSON.stringify({ ...existingJson, primaryApiKey: apiKey }, null, 2))
  } catch {
    // Non-fatal — claude will still work via ANTHROPIC_API_KEY env var
  }
}

export function restoreClaudeConfigOnStartup(): void {
  try {
    const home = homedir()
    const claudeJsonPath = join(home, '.claude.json')
    if (!existsSync(claudeJsonPath)) {
      const backup = restoreFromBackup(join(home, '.claude'))
      if (backup) {
        writeFileSync(claudeJsonPath, JSON.stringify(backup, null, 2))
        console.log('[claude-auth] Restored ~/.claude.json from backup')
      }
    }
  } catch {
    // non-fatal
  }
}

function restoreFromBackup(claudeDir: string): Record<string, unknown> | null {
  try {
    const backupsDir = join(claudeDir, 'backups')
    if (!existsSync(backupsDir)) return null
    const backups = readdirSync(backupsDir)
      .filter((f) => f.startsWith('.claude.json.backup'))
      .sort()
    if (backups.length === 0) return null
    // Use most recent backup
    const latest = join(backupsDir, backups[backups.length - 1])
    return JSON.parse(readFileSync(latest, 'utf8'))
  } catch {
    return null
  }
}
