#!/usr/bin/env node
/**
 * Build Squan as a distributable binary.
 *
 * Usage:
 *   node scripts/build-binary.mjs              # package only (no installer)
 *   node scripts/build-binary.mjs --make       # create installers (.exe, .dmg, .deb)
 *   node scripts/build-binary.mjs --make --arch arm64   # cross-compile
 *
 * What it does:
 *   1. Bumps version
 *   2. Builds server (TypeScript → JS)
 *   3. Builds client (React → static HTML/JS/CSS)
 *   4. Builds Electron main + preload (TypeScript → JS)
 *   5. Creates standalone server bundle (dist-server/ with production deps)
 *   6. Runs electron-forge package (or make for installers)
 *
 * Output:
 *   ./out/Squan-{platform}-{arch}/squan[.exe]     (portable binary)
 *   ./out/make/...                                  (installers, if --make)
 */

import { execSync } from 'child_process'
import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const doMake = args.includes('--make')
const arch = args.includes('--arch') ? args[args.indexOf('--arch') + 1] : undefined

function run(cmd, opts = {}) {
  console.log(`\n[build] $ ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function header(msg) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${msg}`)
  console.log(`${'═'.repeat(60)}`)
}

const startTime = Date.now()

// ── Step 1: Bump version ─────────────────────────────────────────────

header('Step 1/6: Bump version')
try {
  run('node scripts/bump-version.mjs')
} catch {
  console.log('[build] No bump script or already bumped — continuing')
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
console.log(`[build] Version: ${pkg.version}`)

// ── Step 2: Build server ─────────────────────────────────────────────

header('Step 2/6: Build server')
run('npm run build --workspace=server')

// ── Step 3: Build client ─────────────────────────────────────────────

header('Step 3/6: Build client')
run('npm run build --workspace=client')

// ── Step 4: Build Electron ───────────────────────────────────────────

header('Step 4/6: Build Electron shell')
run('cd electron && npx tsc')

// ── Step 5: Package server ───────────────────────────────────────────

header('Step 5/6: Create standalone server bundle')
run('node scripts/package-server.mjs')

// ── Step 6: electron-forge ───────────────────────────────────────────

if (doMake) {
  header('Step 6/6: Create installers (electron-forge make)')
  const archFlag = arch ? ` --arch=${arch}` : ''
  run(`npx electron-forge make${archFlag}`)
} else {
  header('Step 6/6: Package binary (electron-forge package)')
  const archFlag = arch ? ` --arch=${arch}` : ''
  run(`npx electron-forge package${archFlag}`)
}

// ── Done ─────────────────────────────────────────────────────────────

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
const archStr = arch ?? process.arch

header('Build complete!')
console.log(`  Platform:  ${platform}-${archStr}`)
console.log(`  Version:   ${pkg.version}`)
console.log(`  Time:      ${elapsed}s`)
console.log()

if (doMake) {
  console.log('  Installers:')
  if (platform === 'win32') {
    console.log(`    out/make/squirrel.windows/${archStr}/`)
    console.log(`    out/make/zip/win32/${archStr}/Squan-win32-${archStr}-${pkg.version}.zip`)
  } else if (platform === 'darwin') {
    console.log(`    out/make/zip/darwin/${archStr}/Squan-darwin-${archStr}-${pkg.version}.zip`)
  } else {
    console.log(`    out/make/deb/${archStr}/`)
    console.log(`    out/make/zip/linux/${archStr}/Squan-linux-${archStr}-${pkg.version}.zip`)
  }
} else {
  const exeName = platform === 'win32' ? 'squan.exe' : 'squan'
  console.log(`  Binary:`)
  console.log(`    out/Squan-${platform}-${archStr}/${exeName}`)
  console.log()
  console.log('  To create installers, run:')
  console.log('    node scripts/build-binary.mjs --make')
}

console.log()
