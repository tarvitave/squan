const fs = require('fs');
const f = 'server/src/workerbee/process-manager.ts';
let c = fs.readFileSync(f, 'utf8');

// Update opts type to include new fields
c = c.replace(
  '    apiKey: string\n    model?: string\n    maxTurns?: number',
  '    apiKey: string\n    model?: string\n    provider?: string\n    providerUrl?: string\n    maxTurns?: number\n    extensions?: any[]'
);

// Update the start message sent to child
c = c.replace(
  '            apiKey: opts.apiKey,\n            model: opts.model,\n            maxTurns: opts.maxTurns,',
  '            apiKey: opts.apiKey,\n            model: opts.model,\n            provider: opts.provider,\n            providerUrl: opts.providerUrl,\n            maxTurns: opts.maxTurns,\n            extensions: opts.extensions,'
);

fs.writeFileSync(f, c);
console.log('Updated process-manager with provider + extensions fields');
