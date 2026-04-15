const fs = require('fs');
const f = 'client/src/components/KanbanView/index.tsx';
let c = fs.readFileSync(f, 'utf8');

// 1. Add computation of unassigned agents after agentById
const afterAgentById = 'const agentById = Object.fromEntries(agents.map((a) => [a.id, a]))';
const newCompute = `const agentById = Object.fromEntries(agents.map((a) => [a.id, a]))

  // Find agents that completed work but have no release train
  const assignedAgentIds = new Set(releaseTrains.filter(rt => rt.assignedWorkerBeeId).map(rt => rt.assignedWorkerBeeId))
  const unassignedDoneAgents = agents.filter(a => a.status === 'done' && !assignedAgentIds.has(a.id))`;

if (c.includes(afterAgentById)) {
  c = c.replace(afterAgentById, newCompute);
  console.log('Added unassigned agents computation');
}

// 2. Add count of unassigned agents to In Progress column header
const colCount = `<span className="text-xs text-text-tertiary">{cards.length}</span>`;
const newColCount = `<span className="text-xs text-text-tertiary">{cards.length}{col.status === 'in_progress' && unassignedDoneAgents.length > 0 ? \` +\${unassignedDoneAgents.length}\` : ''}</span>`;
c = c.replace(colCount, newColCount);
console.log('Updated column count');

// 3. Add unassigned agent cards after the release train cards, before the empty state
const emptyState = `              {cards.length === 0 && (
                <div className="text-text-tertiary text-xs text-center py-6">
                  No {col.label.toLowerCase()} items
                </div>
              )}`;

const newEmptyState = `              {/* Unassigned done agents — show in In Progress column */}
              {col.status === 'in_progress' && unassignedDoneAgents.map(agent => (
                <div key={agent.id} className="border border-green-200/30 bg-green-50/5 rounded-lg p-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary truncate">{agent.taskDescription?.slice(0, 60) || agent.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-medium">done</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-tertiary">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span>{agent.name}</span>
                    <span className="text-text-disabled">|</span>
                    <span>No release train</span>
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    <button onClick={() => { useStore.getState().setMainView('terminals'); useStore.getState().setSelectedAgentId(agent.id) }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-bg-secondary text-text-secondary hover:text-text-primary transition-colors">
                      💬 View Chat
                    </button>
                    <button onClick={async () => {
                      try {
                        const res = await apiFetch('/api/release-trains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: (agent.taskDescription || agent.name).slice(0, 80), projectId: agent.projectId, description: agent.taskDescription }) })
                        const rt = await res.json()
                        await apiFetch(\`/api/release-trains/\${rt.id}/assign\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerBeeId: agent.id }) })
                        await apiFetch(\`/api/workerbees/\${agent.id}/mark-complete\`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
                        addReleaseTrain({ ...rt, status: 'pr_review', assignedWorkerBeeId: agent.id })
                        addToast('Moved to PR Review', 'info')
                      } catch { addToast('Failed to create release train') }
                    }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors">
                      ✓ Move to PR Review
                    </button>
                  </div>
                </div>
              ))}
              {cards.length === 0 && unassignedDoneAgents.length === 0 && col.status === 'in_progress' && (
                <div className="text-text-tertiary text-xs text-center py-6">
                  No {col.label.toLowerCase()} items
                </div>
              )}
              {cards.length === 0 && col.status !== 'in_progress' && (
                <div className="text-text-tertiary text-xs text-center py-6">
                  No {col.label.toLowerCase()} items
                </div>
              )}`;

if (c.includes(emptyState)) {
  c = c.replace(emptyState, newEmptyState);
  console.log('Added unassigned agent cards');
}

fs.writeFileSync(f, c);
console.log('Done');
