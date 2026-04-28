/**
 * Filesystem tools — read, write, edit, search, copy, move, archive files.
 *
 * Registers 15 tools under the "filesystem" category:
 *
 *   Migrated from direct-runner.ts:
 *     read_file, write_file, edit_file, list_directory, search_files
 *
 *   New:
 *     file_tree, file_stat, glob_files, diff_files, copy_file, move_file,
 *     delete_file, archive_create, archive_extract, file_checksum
 *
 * All paths are resolved relative to `context.cwd`.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  createReadStream,
} from 'fs'

import { join, relative, dirname, resolve, extname } from 'path'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { platform } from 'os'

import type { ToolCategory, ToolHandler, ToolResult, ToolDefinition } from './registry.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve an input path against the agent's cwd, preventing traversal above it. */
function safePath(cwd: string, rel: string): string {
  const abs = resolve(cwd, rel)
  // Allow the cwd itself and anything inside it
  if (!abs.startsWith(resolve(cwd))) {
    throw new Error(`Path "${rel}" resolves outside the working directory`)
  }
  return abs
}

/** Quick success helper. */
function ok(result: string): ToolResult {
  return { result, isError: false }
}

/** Quick error helper. */
function err(result: string): ToolResult {
  return { result, isError: true }
}

/** Format bytes to a human-readable string. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ── .gitignore parsing (lightweight) ─────────────────────────────────────────

/**
 * Reads .gitignore from a directory and returns a predicate that tests
 * whether a *relative* path (forward-slash separated) should be ignored.
 * This intentionally stays simple: no negation patterns, no nested
 * .gitignore files.  For heavy lifting use `git ls-files`.
 */
function loadIgnoreRules(dir: string): (relPath: string) => boolean {
  // Always ignore these regardless of .gitignore
  const builtins = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache'])

  const patterns: RegExp[] = []
  const gitignorePath = join(dir, '.gitignore')
  if (existsSync(gitignorePath)) {
    const lines = readFileSync(gitignorePath, 'utf8').split('\n')
    for (let line of lines) {
      line = line.trim()
      if (!line || line.startsWith('#')) continue
      if (line.startsWith('!')) continue // negation not supported

      // Convert glob-ish pattern to RegExp
      let re = line
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex chars (except * and ?)
        .replace(/\\\*\\\*/g, '@@GLOBSTAR@@')
        .replace(/\\\*/g, '[^/]*')
        .replace(/@@GLOBSTAR@@/g, '.*')
        .replace(/\\\?/g, '[^/]')

      // If pattern has no slash it matches any segment
      if (!line.includes('/')) {
        re = `(^|/)${re}(/|$)`
      } else {
        // Anchored to root of the gitignore dir
        if (re.startsWith('/')) re = re.slice(1)
        re = `^${re}`
        if (line.endsWith('/')) {
          re += '.*' // directory match
        } else {
          re += '(/.*)?$'
        }
      }

      try {
        patterns.push(new RegExp(re))
      } catch {
        // skip unparseable patterns
      }
    }
  }

  return (relPath: string) => {
    // Check builtins first (match any segment)
    const segments = relPath.split('/')
    for (const seg of segments) {
      if (builtins.has(seg)) return true
    }
    for (const pat of patterns) {
      if (pat.test(relPath)) return true
    }
    return false
  }
}

// ── Simple glob matching ─────────────────────────────────────────────────────

/**
 * Converts a glob pattern (e.g. `** / *.ts`) to a RegExp.
 * Supports *, **, and ?.
 */
function globToRegExp(pattern: string): RegExp {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '@@GLOBSTAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@GLOBSTAR@@/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${re}$`)
}

/**
 * Recursively walk a directory yielding relative paths (forward-slash).
 * Respects the ignore predicate.
 */
function* walkDir(
  root: string,
  base: string,
  ignore: (rel: string) => boolean,
  maxDepth: number,
  depth = 0,
): Generator<{ rel: string; abs: string; isDir: boolean }> {
  if (depth > maxDepth) return
  let entries: string[]
  try {
    entries = readdirSync(base)
  } catch {
    return
  }
  for (const name of entries) {
    const abs = join(base, name)
    const rel = relative(root, abs).replace(/\\/g, '/')
    if (ignore(rel)) continue
    let s
    try {
      s = statSync(abs)
    } catch {
      continue
    }
    yield { rel, abs, isDir: s.isDirectory() }
    if (s.isDirectory()) {
      yield* walkDir(root, abs, ignore, maxDepth, depth + 1)
    }
  }
}

// ── Tool handlers ────────────────────────────────────────────────────────────

// 1. read_file
const readFileHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { path: string }
  const filePath = safePath(ctx.cwd, input.path)
  if (!existsSync(filePath)) return err(`File not found: ${input.path}`)
  const s = statSync(filePath)
  if (s.isDirectory()) return err(`Path is a directory, not a file: ${input.path}`)
  const content = readFileSync(filePath, 'utf8')
  const MAX = 50_000
  return ok(content.length > MAX ? content.slice(0, MAX) + '\n... (truncated)' : content)
}

// 2. write_file
const writeFileHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { path: string; content: string }
  const filePath = safePath(ctx.cwd, input.path)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, input.content, 'utf8')
  const lines = input.content.split('\n').length
  return ok(`Written: ${input.path} (${lines} lines)`)
}

// 3. edit_file
const editFileHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { path: string; search: string; replace: string }
  const filePath = safePath(ctx.cwd, input.path)
  if (!existsSync(filePath)) return err(`File not found: ${input.path}`)
  const content = readFileSync(filePath, 'utf8')
  if (!content.includes(input.search)) return err(`Search text not found in ${input.path}`)
  const count = content.split(input.search).length - 1
  if (count > 1) return err(`Search text found ${count} times — must be unique`)
  writeFileSync(filePath, content.replace(input.search, input.replace), 'utf8')
  return ok(`Edited: ${input.path}`)
}

// 4. list_directory
const listDirectoryHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { path?: string; recursive?: boolean }
  const dirPath = safePath(ctx.cwd, input.path ?? '.')
  if (!existsSync(dirPath)) return err(`Directory not found: ${input.path ?? '.'}`)
  const recursive = input.recursive ?? false
  const items: string[] = []

  function scan(dir: string, depth: number) {
    if (depth > 3) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue
      const full = join(dir, entry)
      let s
      try {
        s = statSync(full)
      } catch {
        continue
      }
      const rel = relative(ctx.cwd, full)
      items.push(s.isDirectory() ? `${rel}/` : rel)
      if (recursive && s.isDirectory()) scan(full, depth + 1)
    }
  }

  scan(dirPath, 0)
  return ok(items.join('\n') || '(empty directory)')
}

// 5. search_files
const searchFilesHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { pattern: string; path?: string; file_pattern?: string }
  const searchPath = safePath(ctx.cwd, input.path ?? '.')
  const relSearch = relative(ctx.cwd, searchPath)
  const escaped = input.pattern.replace(/"/g, '\\"')

  // Build git grep command
  let cmd = `git grep -n "${escaped}" -- "${relSearch || '.'}"`
  if (input.file_pattern) cmd += ` "${input.file_pattern}"`

  try {
    const result = execSync(cmd, {
      cwd: ctx.cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    })
    const MAX = 10_000
    return ok(result.length > MAX ? result.slice(0, MAX) + '\n... (truncated)' : result)
  } catch {
    return ok('No matches found')
  }
}

// 6. file_tree
const fileTreeHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { path?: string; max_depth?: number; show_size?: boolean }
  const rootPath = safePath(ctx.cwd, input.path ?? '.')
  if (!existsSync(rootPath)) return err(`Path not found: ${input.path ?? '.'}`)

  const maxDepth = input.max_depth ?? 3
  const showSize = input.show_size ?? false
  const ignore = loadIgnoreRules(ctx.cwd)
  const lines: string[] = []
  const rootRel = relative(ctx.cwd, rootPath).replace(/\\/g, '/') || '.'
  lines.push(rootRel + '/')

  function buildTree(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return
    let entries: Array<{ name: string; abs: string; isDir: boolean; size: number }>
    try {
      entries = readdirSync(dir).map((name) => {
        const abs = join(dir, name)
        const rel = relative(ctx.cwd, abs).replace(/\\/g, '/')
        if (ignore(rel)) return null
        try {
          const s = statSync(abs)
          return { name, abs, isDir: s.isDirectory(), size: s.size }
        } catch {
          return null
        }
      }).filter(Boolean) as any
    } catch {
      return
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      const sizeStr = showSize && !entry.isDir ? ` (${humanSize(entry.size)})` : ''
      const suffix = entry.isDir ? '/' : ''
      lines.push(`${prefix}${connector}${entry.name}${suffix}${sizeStr}`)
      if (entry.isDir) {
        const childPrefix = prefix + (isLast ? '    ' : '│   ')
        buildTree(entry.abs, childPrefix, depth + 1)
      }
    }
  }

  buildTree(rootPath, '', 0)

  const MAX = 50_000
  const output = lines.join('\n')
  return ok(output.length > MAX ? output.slice(0, MAX) + '\n... (truncated)' : output)
}

// 7. file_stat
const fileStatHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { path: string }
  const filePath = safePath(ctx.cwd, input.path)
  if (!existsSync(filePath)) return err(`Path not found: ${input.path}`)
  const s = statSync(filePath)
  const info = {
    path: input.path,
    type: s.isDirectory() ? 'directory' : s.isSymbolicLink() ? 'symlink' : s.isFile() ? 'file' : 'other',
    size: s.size,
    sizeHuman: humanSize(s.size),
    modified: s.mtime.toISOString(),
    created: s.birthtime.toISOString(),
    accessed: s.atime.toISOString(),
    permissions: `0${(s.mode & 0o777).toString(8)}`,
  }
  return ok(JSON.stringify(info, null, 2))
}

// 8. glob_files
const globFilesHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { pattern: string; base_path?: string }
  const basePath = safePath(ctx.cwd, input.base_path ?? '.')
  if (!existsSync(basePath)) return err(`Base path not found: ${input.base_path ?? '.'}`)

  const ignore = loadIgnoreRules(ctx.cwd)
  const re = globToRegExp(input.pattern)
  const matches: string[] = []
  const MAX_RESULTS = 1000

  for (const { rel } of walkDir(ctx.cwd, basePath, ignore, 20)) {
    // Test relative to base_path
    const relToBase = relative(basePath, join(ctx.cwd, rel)).replace(/\\/g, '/')
    if (re.test(relToBase) || re.test(rel)) {
      matches.push(rel)
      if (matches.length >= MAX_RESULTS) break
    }
  }

  if (matches.length === 0) return ok(`No files matching "${input.pattern}"`)
  const suffix = matches.length >= MAX_RESULTS ? `\n... (limited to ${MAX_RESULTS} results)` : ''
  return ok(matches.join('\n') + suffix)
}

// 9. diff_files
const diffFilesHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { file_a: string; file_b: string }
  const pathA = safePath(ctx.cwd, input.file_a)
  const pathB = safePath(ctx.cwd, input.file_b)
  if (!existsSync(pathA)) return err(`File not found: ${input.file_a}`)
  if (!existsSync(pathB)) return err(`File not found: ${input.file_b}`)

  const contentA = readFileSync(pathA, 'utf8')
  const contentB = readFileSync(pathB, 'utf8')

  if (contentA === contentB) return ok('Files are identical')

  // Use a simple line-based unified diff
  const linesA = contentA.split('\n')
  const linesB = contentB.split('\n')
  const diffLines: string[] = [`--- ${input.file_a}`, `+++ ${input.file_b}`]

  // Simple context diff: walk both files and show differences
  const maxLen = Math.max(linesA.length, linesB.length)
  let chunkStart = -1
  let chunkLines: string[] = []

  function flushChunk() {
    if (chunkLines.length > 0) {
      diffLines.push(`@@ chunk @@`)
      diffLines.push(...chunkLines)
      chunkLines = []
      chunkStart = -1
    }
  }

  for (let i = 0; i < maxLen; i++) {
    const a = i < linesA.length ? linesA[i] : undefined
    const b = i < linesB.length ? linesB[i] : undefined

    if (a === b) {
      // context line — include if inside a chunk
      if (chunkStart >= 0) {
        chunkLines.push(` ${a}`)
        // If we've had 3 context lines since last diff, flush
        let lastDiff = -1
        for (let j = chunkLines.length - 1; j >= 0; j--) {
          if (chunkLines[j].startsWith('+') || chunkLines[j].startsWith('-')) { lastDiff = j; break }
        }
        if (lastDiff >= 0 && chunkLines.length - lastDiff > 3) {
          flushChunk()
        }
      }
    } else {
      if (chunkStart < 0) {
        // Start chunk with up to 3 context lines before
        chunkStart = i
        for (let c = Math.max(0, i - 3); c < i; c++) {
          if (c < linesA.length) chunkLines.push(` ${linesA[c]}`)
        }
      }
      if (a !== undefined) chunkLines.push(`-${a}`)
      if (b !== undefined) chunkLines.push(`+${b}`)
    }
  }
  flushChunk()

  const output = diffLines.join('\n')
  const MAX = 50_000
  return ok(output.length > MAX ? output.slice(0, MAX) + '\n... (truncated)' : output)
}

// 10. copy_file
const copyFileHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { source: string; destination: string }
  const src = safePath(ctx.cwd, input.source)
  const dst = safePath(ctx.cwd, input.destination)
  if (!existsSync(src)) return err(`Source not found: ${input.source}`)

  const s = statSync(src)
  if (s.isDirectory()) {
    // Recursive directory copy
    mkdirSync(dst, { recursive: true })
    function copyDirRecursive(srcDir: string, dstDir: string) {
      mkdirSync(dstDir, { recursive: true })
      for (const entry of readdirSync(srcDir)) {
        const srcEntry = join(srcDir, entry)
        const dstEntry = join(dstDir, entry)
        const es = statSync(srcEntry)
        if (es.isDirectory()) {
          copyDirRecursive(srcEntry, dstEntry)
        } else {
          copyFileSync(srcEntry, dstEntry)
        }
      }
    }
    copyDirRecursive(src, dst)
    return ok(`Copied directory: ${input.source} → ${input.destination}`)
  } else {
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    return ok(`Copied: ${input.source} → ${input.destination}`)
  }
}

// 11. move_file
const moveFileHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { source: string; destination: string }
  const src = safePath(ctx.cwd, input.source)
  const dst = safePath(ctx.cwd, input.destination)
  if (!existsSync(src)) return err(`Source not found: ${input.source}`)
  mkdirSync(dirname(dst), { recursive: true })
  renameSync(src, dst)
  return ok(`Moved: ${input.source} → ${input.destination}`)
}

// 12. delete_file
const deleteFileHandler: ToolHandler = (_input, ctx) => {
  const input = _input as { path: string; force?: boolean }
  const filePath = safePath(ctx.cwd, input.path)
  if (!existsSync(filePath)) return err(`Path not found: ${input.path}`)

  const s = statSync(filePath)
  if (s.isDirectory()) {
    if (input.force) {
      rmSync(filePath, { recursive: true, force: true })
      return ok(`Deleted directory (recursive): ${input.path}`)
    }
    // Try to remove empty directory
    try {
      rmSync(filePath)
      return ok(`Deleted empty directory: ${input.path}`)
    } catch {
      return err(`Directory is not empty. Set force=true to delete recursively: ${input.path}`)
    }
  } else {
    unlinkSync(filePath)
    return ok(`Deleted: ${input.path}`)
  }
}

// 13. archive_create
const archiveCreateHandler: ToolHandler = async (_input, ctx) => {
  const input = _input as { paths: string[]; output: string; format?: 'zip' | 'tar.gz' }
  const format = input.format ?? 'zip'
  const outputPath = safePath(ctx.cwd, input.output)
  mkdirSync(dirname(outputPath), { recursive: true })

  // Validate all input paths exist
  const resolvedPaths: string[] = []
  for (const p of input.paths) {
    const abs = safePath(ctx.cwd, p)
    if (!existsSync(abs)) return err(`Path not found: ${p}`)
    resolvedPaths.push(relative(ctx.cwd, abs).replace(/\\/g, '/'))
  }

  const isWindows = platform() === 'win32'
  const pathList = resolvedPaths.map((p) => `"${p}"`).join(' ')

  try {
    if (format === 'tar.gz') {
      if (isWindows) {
        // Use tar on Windows (available since Windows 10 1803)
        execSync(`tar -czf "${relative(ctx.cwd, outputPath)}" ${pathList}`, {
          cwd: ctx.cwd,
          encoding: 'utf8',
          timeout: 60_000,
        })
      } else {
        execSync(`tar -czf "${relative(ctx.cwd, outputPath)}" ${pathList}`, {
          cwd: ctx.cwd,
          encoding: 'utf8',
          timeout: 60_000,
        })
      }
    } else {
      // zip
      if (isWindows) {
        // PowerShell Compress-Archive
        const psPathList = resolvedPaths.map((p) => `'${join(ctx.cwd, p)}'`).join(',')
        execSync(
          `powershell -NoProfile -Command "Compress-Archive -Path ${psPathList} -DestinationPath '${outputPath}' -Force"`,
          { cwd: ctx.cwd, encoding: 'utf8', timeout: 60_000 },
        )
      } else {
        execSync(`zip -r "${relative(ctx.cwd, outputPath)}" ${pathList}`, {
          cwd: ctx.cwd,
          encoding: 'utf8',
          timeout: 60_000,
        })
      }
    }
    return ok(`Archive created: ${input.output} (${format})`)
  } catch (e) {
    return err(`Failed to create archive: ${(e as Error).message}`)
  }
}

// 14. archive_extract
const archiveExtractHandler: ToolHandler = async (_input, ctx) => {
  const input = _input as { archive_path: string; destination?: string }
  const archivePath = safePath(ctx.cwd, input.archive_path)
  if (!existsSync(archivePath)) return err(`Archive not found: ${input.archive_path}`)

  const destPath = safePath(ctx.cwd, input.destination ?? '.')
  mkdirSync(destPath, { recursive: true })

  const isWindows = platform() === 'win32'
  const ext = extname(input.archive_path).toLowerCase()
  const isTar = input.archive_path.endsWith('.tar.gz') || input.archive_path.endsWith('.tgz') || ext === '.tar'

  try {
    if (isTar) {
      execSync(`tar -xf "${archivePath}" -C "${destPath}"`, {
        cwd: ctx.cwd,
        encoding: 'utf8',
        timeout: 60_000,
      })
    } else if (ext === '.zip') {
      if (isWindows) {
        execSync(
          `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destPath}' -Force"`,
          { cwd: ctx.cwd, encoding: 'utf8', timeout: 60_000 },
        )
      } else {
        execSync(`unzip -o "${archivePath}" -d "${destPath}"`, {
          cwd: ctx.cwd,
          encoding: 'utf8',
          timeout: 60_000,
        })
      }
    } else {
      return err(`Unsupported archive format: ${ext}. Supported: .zip, .tar, .tar.gz, .tgz`)
    }
    return ok(`Extracted: ${input.archive_path} → ${input.destination ?? '.'}`)
  } catch (e) {
    return err(`Failed to extract archive: ${(e as Error).message}`)
  }
}

// 15. file_checksum
const fileChecksumHandler: ToolHandler = async (_input, ctx) => {
  const input = _input as { path: string }
  const filePath = safePath(ctx.cwd, input.path)
  if (!existsSync(filePath)) return err(`File not found: ${input.path}`)
  const s = statSync(filePath)
  if (s.isDirectory()) return err(`Path is a directory: ${input.path}`)

  return new Promise<ToolResult>((resolve) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () =>
      resolve(ok(JSON.stringify({ path: input.path, sha256: hash.digest('hex'), size: s.size }, null, 2))),
    )
    stream.on('error', (e) => resolve(err(`Hash error: ${e.message}`)))
  })
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const CATEGORY = 'filesystem'

function def(name: string, description: string, properties: Record<string, any>, required: string[]): ToolDefinition {
  return {
    name,
    description,
    category: CATEGORY,
    input_schema: { type: 'object' as const, properties, required },
  }
}

const filesystemCategory: ToolCategory = {
  name: CATEGORY,
  description: 'File system operations — read, write, edit, search, copy, move, and archive files.',
  tools: [
    // 1. read_file
    {
      definition: def(
        'read_file',
        'Read the contents of a file at the given path. Use this to understand existing code.',
        {
          path: { type: 'string', description: 'File path relative to the project root' },
        },
        ['path'],
      ),
      handler: readFileHandler,
    },
    // 2. write_file
    {
      definition: def(
        'write_file',
        'Write content to a file. Creates parent directories if needed. Use this to create or overwrite files.',
        {
          path: { type: 'string', description: 'File path relative to the project root' },
          content: { type: 'string', description: 'Complete file content to write' },
        },
        ['path', 'content'],
      ),
      handler: writeFileHandler,
    },
    // 3. edit_file
    {
      definition: def(
        'edit_file',
        'Edit a file by finding and replacing text. The search text must match exactly and uniquely.',
        {
          path: { type: 'string', description: 'File path relative to the project root' },
          search: { type: 'string', description: 'Exact text to find (must match uniquely)' },
          replace: { type: 'string', description: 'Text to replace with' },
        },
        ['path', 'search', 'replace'],
      ),
      handler: editFileHandler,
    },
    // 4. list_directory
    {
      definition: def(
        'list_directory',
        'List files and directories at a given path. Use to explore project structure.',
        {
          path: { type: 'string', description: 'Directory path relative to project root (default: ".")' },
          recursive: { type: 'boolean', description: 'List recursively (default: false, max depth 3)' },
        },
        [],
      ),
      handler: listDirectoryHandler,
    },
    // 5. search_files
    {
      definition: def(
        'search_files',
        'Search for a pattern across files in the project (like grep). Returns matching lines with file paths.',
        {
          pattern: { type: 'string', description: 'Search pattern (regex supported)' },
          path: { type: 'string', description: 'Directory to search in (default: ".")' },
          file_pattern: { type: 'string', description: 'File glob pattern (e.g. "*.ts", "*.py")' },
        },
        ['pattern'],
      ),
      handler: searchFilesHandler,
    },
    // 6. file_tree
    {
      definition: def(
        'file_tree',
        'Show a full directory tree with indentation (like the `tree` command), respecting .gitignore.',
        {
          path: { type: 'string', description: 'Root directory path (default: ".")' },
          max_depth: { type: 'number', description: 'Maximum depth to recurse (default: 3)' },
          show_size: { type: 'boolean', description: 'Show file sizes (default: false)' },
        },
        [],
      ),
      handler: fileTreeHandler,
    },
    // 7. file_stat
    {
      definition: def(
        'file_stat',
        'Get file metadata — size, modified date, created date, permissions, type.',
        {
          path: { type: 'string', description: 'File or directory path' },
        },
        ['path'],
      ),
      handler: fileStatHandler,
    },
    // 8. glob_files
    {
      definition: def(
        'glob_files',
        'Find files matching a glob pattern. Returns matching file paths.',
        {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.test.*")' },
          base_path: { type: 'string', description: 'Base directory to search from (default: ".")' },
        },
        ['pattern'],
      ),
      handler: globFilesHandler,
    },
    // 9. diff_files
    {
      definition: def(
        'diff_files',
        'Show a unified diff between two files, highlighting additions and deletions.',
        {
          file_a: { type: 'string', description: 'First file path' },
          file_b: { type: 'string', description: 'Second file path' },
        },
        ['file_a', 'file_b'],
      ),
      handler: diffFilesHandler,
    },
    // 10. copy_file
    {
      definition: def(
        'copy_file',
        'Copy a file or directory (recursively) to a new location.',
        {
          source: { type: 'string', description: 'Source file or directory path' },
          destination: { type: 'string', description: 'Destination path' },
        },
        ['source', 'destination'],
      ),
      handler: copyFileHandler,
    },
    // 11. move_file
    {
      definition: def(
        'move_file',
        'Move or rename a file or directory.',
        {
          source: { type: 'string', description: 'Current path' },
          destination: { type: 'string', description: 'New path' },
        },
        ['source', 'destination'],
      ),
      handler: moveFileHandler,
    },
    // 12. delete_file
    {
      definition: def(
        'delete_file',
        'Delete a file or directory. For non-empty directories, set force=true.',
        {
          path: { type: 'string', description: 'File or directory path to delete' },
          force: { type: 'boolean', description: 'If true, recursively delete non-empty directories (default: false)' },
        },
        ['path'],
      ),
      handler: deleteFileHandler,
    },
    // 13. archive_create
    {
      definition: def(
        'archive_create',
        'Create a zip or tar.gz archive from one or more files/directories.',
        {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of file/directory paths to include in the archive',
          },
          output: { type: 'string', description: 'Output archive path (e.g. "backup.zip")' },
          format: {
            type: 'string',
            enum: ['zip', 'tar.gz'],
            description: 'Archive format (default: "zip")',
          },
        },
        ['paths', 'output'],
      ),
      handler: archiveCreateHandler,
    },
    // 14. archive_extract
    {
      definition: def(
        'archive_extract',
        'Extract a zip or tar archive to a destination directory.',
        {
          archive_path: { type: 'string', description: 'Path to the archive file' },
          destination: { type: 'string', description: 'Directory to extract into (default: ".")' },
        },
        ['archive_path'],
      ),
      handler: archiveExtractHandler,
    },
    // 15. file_checksum
    {
      definition: def(
        'file_checksum',
        'Calculate the SHA-256 hash of a file for integrity verification.',
        {
          path: { type: 'string', description: 'File path to hash' },
        },
        ['path'],
      ),
      handler: fileChecksumHandler,
    },
  ],
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Exported as `filesystemTools` to match the convention used by tools/index.ts.
 * Registration is handled centrally in tools/index.ts — do NOT self-register here.
 */
export { filesystemCategory as filesystemTools }
