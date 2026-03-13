import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Pre-writes ~/.claude/settings.json with the API key so claude starts
 * without showing the interactive login method selection prompt.
 * Safe to call multiple times — merges with existing settings.
 */
export function preconfigureClaudeAuth(apiKey: string): void {
  try {
    const dir = join(homedir(), '.claude')
    mkdirSync(dir, { recursive: true })

    const settingsPath = join(dir, 'settings.json')
    let existing: Record<string, unknown> = {}
    if (existsSync(settingsPath)) {
      try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')) } catch { /* ignore */ }
    }

    writeFileSync(settingsPath, JSON.stringify({ ...existing, primaryApiKey: apiKey }, null, 2))
  } catch {
    // Non-fatal — claude will still work via ANTHROPIC_API_KEY env var
  }
}
