const fs = require('fs');
const path = require('path');

// All files that might reference "recipe"
const files = [
  'server/src/recipes/index.ts',
  'server/src/index.ts',
  'server/src/db/index.ts',
  'client/src/components/PreferencesPanel/index.tsx',
  'CHANGELOG.md',
  'README.md',
];

let totalChanges = 0;

for (const f of files) {
  if (!fs.existsSync(f)) { console.log('SKIP (not found):', f); continue; }
  let c = fs.readFileSync(f, 'utf8');
  const orig = c;

  // Order matters — do plurals first to avoid double-replacing
  c = c.replace(/RECIPES/g, 'SKILLS');
  c = c.replace(/Recipes/g, 'Skills');
  c = c.replace(/recipes/g, 'skills');
  c = c.replace(/RECIPE/g, 'SKILL');
  c = c.replace(/Recipe/g, 'Skill');
  c = c.replace(/recipe/g, 'skill');

  if (c !== orig) {
    fs.writeFileSync(f, c);
    const count = (orig.length - orig.replace(/[Rr]ecipe/g, '').length) / 6; // rough count
    console.log('Updated:', f);
    totalChanges++;
  } else {
    console.log('No changes:', f);
  }
}

// Rename the directory: server/src/recipes/ → server/src/skills/
const oldDir = 'server/src/recipes';
const newDir = 'server/src/skills';
if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
  fs.mkdirSync(newDir, { recursive: true });
  for (const file of fs.readdirSync(oldDir)) {
    fs.renameSync(path.join(oldDir, file), path.join(newDir, file));
  }
  fs.rmdirSync(oldDir);
  console.log('Renamed directory: recipes/ → skills/');
  totalChanges++;
}

// Fix the import path in index.ts
const indexPath = 'server/src/index.ts';
if (fs.existsSync(indexPath)) {
  let c = fs.readFileSync(indexPath, 'utf8');
  c = c.replace("from './skills/index.js'", "from './skills/index.js'"); // already correct after rename
  c = c.replace("from './recipes/index.js'", "from './skills/index.js'"); // fix if old path remains
  fs.writeFileSync(indexPath, c);
}

// Fix DB table name: recipes → skills
const dbPath = 'server/src/db/index.ts';
if (fs.existsSync(dbPath)) {
  let c = fs.readFileSync(dbPath, 'utf8');
  // The CREATE TABLE and queries already got renamed by the global replace above
  fs.writeFileSync(dbPath, c);
}

console.log('\nDone.', totalChanges, 'files updated');
