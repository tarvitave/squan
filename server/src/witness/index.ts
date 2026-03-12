import { workerBeeManager } from '../polecat/manager.js'
import { ptyManager } from '../polecat/pty.js'

// Sandy - Watch Agent: monitors WorkerBee health, detects zombies and stalled agents

const POLL_INTERVAL_MS = 30_000

export function startWitness() {
  setInterval(patrolAll, POLL_INTERVAL_MS)
}

// Sandy's patrol — checks all WorkerBees for zombie/stall conditions
async function patrolAll() {
  const bees = await workerBeeManager.listAll()

  for (const bee of bees) {
    if (bee.status === 'done' || bee.status === 'zombie') continue

    const sessionAlive = bee.sessionId
      ? ptyManager.list().includes(bee.sessionId)
      : false

    if (!sessionAlive && bee.status === 'working') {
      console.warn(`[Sandy] WorkerBee ${bee.name} (${bee.id}) is zombie — session gone`)
      await workerBeeManager.updateStatus(bee.id, 'zombie')
    }
  }
}
