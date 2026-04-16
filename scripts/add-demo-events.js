const fs = require('fs');
const f = 'server/src/types/index.ts';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(
  "| 'atomictask.created'",
  "| 'atomictask.created'\n  | 'demo.loaded'\n  | 'demo.reset'"
);

fs.writeFileSync(f, c);
console.log('Added demo event types');
