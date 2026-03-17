import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const paths = [
  resolve(root, 'package.json'),
  resolve(root, 'server/package.json'),
  resolve(root, 'client/package.json'),
]

// Read root version and bump patch
const rootPkg = JSON.parse(readFileSync(paths[0], 'utf8'))
const [major, minor, patch] = rootPkg.version.split('.').map(Number)
const newVersion = `${major}.${minor}.${patch + 1}`

for (const pkgPath of paths) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.version = newVersion
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

console.log(`version bumped: ${rootPkg.version} → ${newVersion}`)
