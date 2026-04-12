#!/usr/bin/env node
/**
 * Package Squan as a standalone binary using @electron/packager directly.
 * Bypasses electron-forge to avoid the EBUSY race condition on Windows.
 *
 * Usage:
 *   node scripts/package-binary.mjs           (quick, uses cached builds)
 *   node scripts/package-binary.mjs --clean   (full rebuild)
 */

import { execSync } from 'child_process'
import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
// Build to user's home directory to avoid VS Code file watcher locking issues
const OUT_DIR = process.env.SQUAN_BUILD_DIR || join(process.env.USERPROFILE || process.env.HOME || ROOT, 'squan-dist')
const PLATFORM = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
const ARCH = process.arch
const APP_NAME = 'Squan'
const OUT_NAME = `${APP_NAME}-${PLATFORM}-${ARCH}`
const TARGET = join(OUT_DIR, OUT_NAME)

const clean = process.argv.includes('--clean')

function run(cmd) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}

function header(msg) {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  ${msg}`)
  console.log(`${'─'.repeat(50)}`)
}

const startTime = Date.now()

// ── Step 1: Build everything ─────────────────────────────────────────

if (clean) {
  header('Step 1: Full build')
  run('npm run build:server')
  run('npm run build:client')
  run('npm run build:electron')
} else {
  header('Step 1: Checking builds')
  if (!existsSync(join(ROOT, 'server', 'dist', 'index.js'))) run('npm run build:server')
  if (!existsSync(join(ROOT, 'client', 'dist', 'index.html'))) run('npm run build:client')
  if (!existsSync(join(ROOT, '.vite', 'build', 'main.js'))) run('npm run build:electron')
  console.log('  ✓ All builds up to date')
}

// ── Step 2: Package server ───────────────────────────────────────────

header('Step 2: Server bundle')
if (!existsSync(join(ROOT, 'dist-server', 'dist', 'index.js')) || clean) {
  run('node scripts/package-server.mjs')
} else {
  console.log('  ✓ Server bundle exists (use --clean to rebuild)')
}

// ── Step 3: Clean output ─────────────────────────────────────────────

if (existsSync(TARGET)) {
  header('Step 3: Cleaning old output')
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(TARGET, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 })
      console.log('  ✓ Cleaned')
      break
    } catch (err) {
      if (i < 4) {
        console.log(`  Retry ${i + 1}/5 — ${err.code}`)
        execSync('powershell -Command "Start-Sleep -Seconds 2"', { stdio: 'pipe' })
      } else {
        console.error('  ✗ Could not clean output directory. Close VS Code or any file explorer windows in out/ and retry.')
        process.exit(1)
      }
    }
  }
} else {
  header('Step 3: Output directory clean')
}

// ── Step 4: Package ──────────────────────────────────────────────────

header('Step 4: Packaging with @electron/packager')
mkdirSync(OUT_DIR, { recursive: true })

run([
  'npx @electron/packager .',
  `"${APP_NAME}"`,
  `--platform=${PLATFORM}`,
  `--arch=${ARCH}`,
  `--out="${OUT_DIR}"`,
  '--overwrite',
  '--asar',
  '--asar-unpack="**/node_modules/node-pty/**"',
  '--extra-resource=dist-server',
  '--extra-resource=client/dist',
  // Ignore dev files — only ship what's needed
  '--ignore="^/(server|electron|scripts|docs|\\.squan|\\.vscode|\\.git$|\\.github|assets)"',
  '--ignore="^/(forge\\.config|vite\\.|tsconfig|postcss|\\.env|\\.gitignore)"',
  '--ignore="^/node_modules/(@electron/packager|@electron-forge|electron-forge|vite|@vitejs|tailwindcss|@tailwindcss|typescript|concurrently|@types)"',
].join(' '))

// ── Step 5: Verify ───────────────────────────────────────────────────

header('Step 5: Verify')
const exeName = PLATFORM === 'win32' ? `${APP_NAME.toLowerCase()}.exe` : APP_NAME.toLowerCase()
const exePath = join(TARGET, exeName)

if (existsSync(exePath)) {
  const sizeMB = (statSync(exePath).size / 1024 / 1024).toFixed(1)
  const serverOk = existsSync(join(TARGET, 'resources', 'dist-server', 'dist', 'index.js'))
  const clientOk = existsSync(join(TARGET, 'resources', 'dist', 'index.html'))

  console.log(`  ✓ Binary: ${exePath} (${sizeMB} MB)`)
  console.log(`  ${serverOk ? '✓' : '✗'} Server bundle`)
  console.log(`  ${clientOk ? '✓' : '✗'} Client bundle`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  console.log(`\n  ✓ Squan v${pkg.version} packaged in ${elapsed}s`)
  console.log(`  Run: ${exePath}`)
} else {
  console.error(`  ✗ Binary not found!`)
  process.exit(1)
}
