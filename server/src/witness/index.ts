import { polecatManager } from '../polecat/manager.js'
import { ptyManager } from '../polecat/pty.js'

// Witness: monitors polecat health on a polling interval
// Mirrors Gas Town's witness agent — detects zombies, stalled workers

const POLL_INTERVAL_MS = 30_000

export function startWitness() {
  setInterval(patrolAll, POLL_INTERVAL_MS)
}

async function patrolAll() {
  const polecats = await polecatManager.listAll()

  for (const polecat of polecats) {
    if (polecat.status === 'done' || polecat.status === 'zombie') continue

    const sessionAlive = polecat.sessionId
      ? ptyManager.list().includes(polecat.sessionId)
      : false

    if (!sessionAlive && polecat.status === 'working') {
      console.warn(`[witness] polecat ${polecat.name} (${polecat.id}) is zombie — session gone`)
      await polecatManager.updateStatus(polecat.id, 'zombie')
    }
  }
}
