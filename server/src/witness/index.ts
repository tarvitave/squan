import { workerBeeManager } from '../workerbee/manager.js'
import { ptyManager } from '../workerbee/pty.js'

// Sandy - Watch Agent: monitors WorkerBee health, detects zombies and stalled agents

const POLL_INTERVAL_MS = 30_000
const STALL_THRESHOLD_MS = 5 * 60 * 1000  // 5 minutes of no output = stalled

export function startWitness() {
  setInterval(patrolAll, POLL_INTERVAL_MS)
  console.log(`[Sandy] Watch agent started — polling every ${POLL_INTERVAL_MS / 1000}s, stall threshold ${STALL_THRESHOLD_MS / 60000}m`)
}

// Sandy's patrol — checks all WorkerBees for zombie/stall conditions
async function patrolAll() {
  const bees = await workerBeeManager.listAll()
  const now = Date.now()

  for (const bee of bees) {
    if (bee.status === 'done' || bee.status === 'zombie') continue

    const sessionAlive = bee.sessionId
      ? ptyManager.list().includes(bee.sessionId)
      : false

    // Zombie detection: session died while bee was working
    if (!sessionAlive && bee.status === 'working') {
      console.warn(`[Sandy] WorkerBee ${bee.name} (${bee.id}) is zombie — session gone`)
      await workerBeeManager.updateStatus(bee.id, 'zombie')
      continue
    }

    // Stall detection: session alive but no output for STALL_THRESHOLD_MS
    if (sessionAlive && bee.status === 'working' && bee.sessionId) {
      const lastOutput = ptyManager.getLastOutputAt(bee.sessionId)
      if (lastOutput) {
        const elapsed = now - lastOutput.getTime()
        if (elapsed > STALL_THRESHOLD_MS) {
          const minutes = Math.round(elapsed / 60000)
          console.warn(`[Sandy] WorkerBee ${bee.name} (${bee.id}) is stalled — no output for ${minutes}m`)
          await workerBeeManager.updateStatus(bee.id, 'stalled')
        }
      }
    }
  }
}
