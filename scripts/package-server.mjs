#!/usr/bin/env node
/**
 * Creates a standalone server bundle at ./dist-server/
 * with compiled JS + production-only node_modules.
 * Used by electron-forge packaging.
 *
 * Incremental: skips npm install if node_modules already exists
 * and package.json hasn't changed.
 */
import { execSync } from 'child_process'
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const OUT = join(ROOT, 'dist-server')
const force = process.argv.includes('--force')

console.log('[package-server] Creating standalone server bundle...')

mkdirSync(OUT, { recursive: true })

// Copy compiled server JS (always — it's fast)
if (existsSync(join(OUT, 'dist'))) rmSync(join(OUT, 'dist'), { recursive: true })
cpSync(join(ROOT, 'server', 'dist'), join(OUT, 'dist'), { recursive: true })
console.log('[package-server] ✓ Copied server/dist')

// Copy .env if it exists
const envFile = join(ROOT, 'server', '.env')
if (existsSync(envFile)) {
  copyFileSync(envFile, join(OUT, '.env'))
}

// Check if we need to reinstall deps (skip if package.json unchanged)
const srcPkg = readFileSync(join(ROOT, 'server', 'package.json'), 'utf8')
const dstPkgPath = join(OUT, 'package.json')
const dstPkg = existsSync(dstPkgPath) ? readFileSync(dstPkgPath, 'utf8') : ''
const depsExist = existsSync(join(OUT, 'node_modules'))

if (!force && depsExist && srcPkg === dstPkg) {
  console.log('[package-server] ✓ Dependencies up to date (skipping npm install)')
} else {
  copyFileSync(join(ROOT, 'server', 'package.json'), dstPkgPath)
  console.log('[package-server] Installing production dependencies...')
  execSync('npm install --omit=dev', { cwd: OUT, stdio: 'inherit' })
  console.log('[package-server] ✓ Dependencies installed')
}

console.log('[package-server] Done — standalone server at ./dist-server/')
