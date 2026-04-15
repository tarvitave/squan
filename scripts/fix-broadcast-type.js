const fs = require('fs');
const f = 'server/src/index.ts';
let c = fs.readFileSync(f, 'utf8');

// Fix both instances: payload: rt → payload: rt as any
// Find lines near 729 and 746
c = c.replace(
  "broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt, timestamp: new Date().toISOString() })",
  "broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt as any, timestamp: new Date().toISOString() })"
);
c = c.replace(
  "broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt2, timestamp: new Date().toISOString() })",
  "broadcastEvent({ id: randomUUID(), type: 'releasetrain.created', payload: rt2 as any, timestamp: new Date().toISOString() })"
);

fs.writeFileSync(f, c);
console.log('Fixed broadcast type errors');
