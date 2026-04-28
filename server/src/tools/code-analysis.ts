import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname, relative, resolve, dirname } from 'path'
import { createHash } from 'crypto'
import type { ToolCategory, ToolContext, ToolResult } from './registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(result: string): ToolResult {
  return { result: result || '(no output)', isError: false }
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err)
  return { result: msg, isError: true }
}

/** Recursively collect files under `dir`, respecting a basic skip-list. */
function walkFiles(dir: string, maxDepth = 10, _depth = 0): string[] {
  if (_depth > maxDepth) return []
  const SKIP = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next',
    '__pycache__', '.venv', 'venv', 'target', 'coverage', '.turbo',
  ])
  const results: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    try {
      const st = statSync(full)
      if (st.isDirectory()) {
        results.push(...walkFiles(full, maxDepth, _depth + 1))
      } else if (st.isFile()) {
        results.push(full)
      }
    } catch {
      // skip inaccessible
    }
  }
  return results
}

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.cs', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.swift', '.kt', '.scala', '.vue', '.svelte',
])

function isSource(file: string): boolean {
  return SOURCE_EXTS.has(extname(file).toLowerCase())
}

function readText(file: string): string {
  return readFileSync(file, 'utf8')
}

// ---------------------------------------------------------------------------
// Symbol regex patterns per language family
// ---------------------------------------------------------------------------

interface SymbolMatch {
  type: 'function' | 'class' | 'interface' | 'export'
  name: string
  line: number
}

function findSymbolsInSource(content: string, ext: string): SymbolMatch[] {
  const lines = content.split('\n')
  const matches: SymbolMatch[] = []

  // language-specific regexes
  const patterns: Array<{ re: RegExp; type: SymbolMatch['type'] }> = []

  const e = ext.toLowerCase()
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(e)) {
    patterns.push(
      { re: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, type: 'function' },
      { re: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g, type: 'function' },
      { re: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*\w[^=]*)?=>/g, type: 'function' },
      { re: /(?:export\s+)?class\s+(\w+)/g, type: 'class' },
      { re: /(?:export\s+)?interface\s+(\w+)/g, type: 'interface' },
      { re: /(?:export\s+)?type\s+(\w+)\s*=/g, type: 'interface' },
      { re: /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g, type: 'export' },
      { re: /^\s*(\w+)\s*\([^)]*\)\s*\{/gm, type: 'function' }, // method shorthand
    )
  } else if (e === '.py') {
    patterns.push(
      { re: /^(?:async\s+)?def\s+(\w+)/gm, type: 'function' },
      { re: /^class\s+(\w+)/gm, type: 'class' },
    )
  } else if (e === '.rs') {
    patterns.push(
      { re: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g, type: 'function' },
      { re: /(?:pub\s+)?struct\s+(\w+)/g, type: 'class' },
      { re: /(?:pub\s+)?trait\s+(\w+)/g, type: 'interface' },
      { re: /(?:pub\s+)?enum\s+(\w+)/g, type: 'class' },
      { re: /(?:pub\s+)?impl\s+(\w+)/g, type: 'class' },
    )
  } else if (e === '.go') {
    patterns.push(
      { re: /func\s+(?:\([^)]*\)\s+)?(\w+)/g, type: 'function' },
      { re: /type\s+(\w+)\s+struct/g, type: 'class' },
      { re: /type\s+(\w+)\s+interface/g, type: 'interface' },
    )
  } else if (e === '.java' || e === '.cs' || e === '.kt' || e === '.scala') {
    patterns.push(
      { re: /(?:public|private|protected|static|abstract|override|internal|final|open|suspend)*\s*(?:fun|void|int|long|String|boolean|double|float|var|val|def|async)?\s+(\w+)\s*\(/g, type: 'function' },
      { re: /(?:public|private|protected|abstract|static|final|sealed|open|data|internal)*\s*class\s+(\w+)/g, type: 'class' },
      { re: /(?:public|private|protected)?\s*interface\s+(\w+)/g, type: 'interface' },
    )
  } else {
    // Fallback generic patterns
    patterns.push(
      { re: /(?:function|def|fn|func)\s+(\w+)/g, type: 'function' },
      { re: /class\s+(\w+)/g, type: 'class' },
      { re: /interface\s+(\w+)/g, type: 'interface' },
    )
  }

  for (const { re, type } of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      // figure out line number
      const upTo = content.slice(0, m.index)
      const line = upTo.split('\n').length
      matches.push({ type, name: m[1], line })
    }
  }

  // deduplicate by name+line
  const seen = new Set<string>()
  return matches.filter((s) => {
    const key = `${s.name}:${s.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => a.line - b.line)
}

// ---------------------------------------------------------------------------
// Tool category
// ---------------------------------------------------------------------------

export const codeAnalysisTools: ToolCategory = {
  name: 'code-analysis',
  description:
    'Code analysis tools — find symbols, references, metrics, dependencies, lint checks, outlines, and duplicates.',
  tools: [
    // 1. find_symbols ------------------------------------------------------
    {
      definition: {
        name: 'find_symbols',
        description:
          'Find function, class, interface, and export definitions in a file or directory.',
        category: 'code-analysis',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'File or directory to scan.',
            },
            pattern: {
              type: 'string',
              description: 'Optional name filter (substring or regex).',
            },
            type: {
              type: 'string',
              enum: ['function', 'class', 'interface', 'export', 'all'],
              description: 'Filter by symbol type.',
            },
          },
          required: ['path'],
        },
      },
      handler(input, ctx) {
        try {
          const target = resolve(ctx.cwd, input.path as string)
          const filterType = (input.type as string) || 'all'
          const patternStr = input.pattern as string | undefined
          const nameFilter = patternStr ? new RegExp(patternStr, 'i') : null

          let files: string[]
          const st = statSync(target)
          if (st.isDirectory()) {
            files = walkFiles(target).filter(isSource)
          } else {
            files = [target]
          }

          const results: string[] = []
          let totalCount = 0

          for (const file of files) {
            const content = readText(file)
            let symbols = findSymbolsInSource(content, extname(file))

            if (filterType !== 'all') {
              symbols = symbols.filter((s) => s.type === filterType)
            }
            if (nameFilter) {
              symbols = symbols.filter((s) => nameFilter.test(s.name))
            }
            if (symbols.length === 0) continue

            const rel = relative(ctx.cwd, file)
            for (const s of symbols) {
              results.push(`${rel}:${s.line}  [${s.type}] ${s.name}`)
              totalCount++
            }
          }

          if (totalCount === 0) return ok('No symbols found matching the criteria.')
          return ok(`Found ${totalCount} symbol(s):\n\n${results.join('\n')}`)
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 2. find_references ---------------------------------------------------
    {
      definition: {
        name: 'find_references',
        description: 'Find all references to a symbol name across the project.',
        category: 'code-analysis',
        input_schema: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Symbol name to search for.',
            },
            path: {
              type: 'string',
              description: 'Directory to search (default: cwd).',
            },
            file_pattern: {
              type: 'string',
              description: 'File extension filter, e.g. ".ts" or ".py".',
            },
          },
          required: ['symbol'],
        },
      },
      handler(input, ctx) {
        try {
          const symbol = input.symbol as string
          const searchDir = resolve(ctx.cwd, (input.path as string) || '.')
          const filePattern = input.file_pattern as string | undefined
          const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')

          let files = walkFiles(searchDir).filter(isSource)
          if (filePattern) {
            files = files.filter((f) => f.endsWith(filePattern))
          }

          const results: string[] = []
          let totalCount = 0

          for (const file of files) {
            const content = readText(file)
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                re.lastIndex = 0
                const rel = relative(ctx.cwd, file)
                results.push(`${rel}:${i + 1}  ${lines[i].trim()}`)
                totalCount++
              }
            }
          }

          if (totalCount === 0) return ok(`No references to "${symbol}" found.`)
          return ok(`Found ${totalCount} reference(s) to "${symbol}":\n\n${results.join('\n')}`)
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 3. code_metrics ------------------------------------------------------
    {
      definition: {
        name: 'code_metrics',
        description:
          'Calculate code metrics (LOC, blanks, comments, functions, classes, imports) for a file or directory.',
        category: 'code-analysis',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'File or directory to analyze.',
            },
          },
          required: ['path'],
        },
      },
      handler(input, ctx) {
        try {
          const target = resolve(ctx.cwd, input.path as string)
          const st = statSync(target)
          const files = st.isDirectory()
            ? walkFiles(target).filter(isSource)
            : [target]

          let totalLoc = 0
          let totalBlank = 0
          let totalComment = 0
          let totalFunctions = 0
          let totalClasses = 0
          let totalImports = 0
          const perFile: string[] = []

          for (const file of files) {
            const content = readText(file)
            const lines = content.split('\n')
            const ext = extname(file).toLowerCase()

            let loc = 0
            let blank = 0
            let comment = 0
            let imports = 0
            let inBlockComment = false

            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed === '') {
                blank++
                continue
              }

              // Block comments
              if (!inBlockComment) {
                if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
                  inBlockComment = true
                  comment++
                  if (trimmed.includes('*/')) inBlockComment = false
                  continue
                }
                if (
                  trimmed.startsWith('//') ||
                  trimmed.startsWith('#') && ['.py', '.rb'].includes(ext) ||
                  trimmed.startsWith('--') && ext === '.lua'
                ) {
                  comment++
                  continue
                }
              } else {
                comment++
                if (trimmed.includes('*/')) inBlockComment = false
                continue
              }

              // imports
              if (
                /^import\s/.test(trimmed) ||
                /^from\s/.test(trimmed) ||
                /require\s*\(/.test(trimmed) ||
                /^use\s/.test(trimmed) && ext === '.rs' ||
                /^using\s/.test(trimmed) && ext === '.cs'
              ) {
                imports++
              }

              loc++
            }

            const symbols = findSymbolsInSource(content, ext)
            const fns = symbols.filter((s) => s.type === 'function').length
            const cls = symbols.filter((s) => s.type === 'class').length

            totalLoc += loc
            totalBlank += blank
            totalComment += comment
            totalFunctions += fns
            totalClasses += cls
            totalImports += imports

            if (files.length <= 30) {
              const rel = relative(ctx.cwd, file)
              perFile.push(
                `  ${rel}: ${loc} LOC, ${blank} blank, ${comment} comment, ${fns} fn, ${cls} cls, ${imports} imp`,
              )
            }
          }

          const summary = [
            `Files analyzed: ${files.length}`,
            `Lines of code:  ${totalLoc}`,
            `Blank lines:    ${totalBlank}`,
            `Comment lines:  ${totalComment}`,
            `Functions:      ${totalFunctions}`,
            `Classes:        ${totalClasses}`,
            `Imports:        ${totalImports}`,
          ].join('\n')

          if (perFile.length) {
            return ok(summary + '\n\nPer file:\n' + perFile.join('\n'))
          }
          return ok(summary)
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 4. dependency_graph --------------------------------------------------
    {
      definition: {
        name: 'dependency_graph',
        description:
          'Show import/require dependencies for a source file, resolving relative paths.',
        category: 'code-analysis',
        input_schema: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'Source file to analyze.',
            },
          },
          required: ['file'],
        },
      },
      handler(input, ctx) {
        try {
          const file = resolve(ctx.cwd, input.file as string)
          const content = readText(file)
          const ext = extname(file).toLowerCase()
          const dir = dirname(file)

          interface Dep {
            raw: string
            resolved: string | null
            names: string[]
          }

          const deps: Dep[] = []

          // ES import patterns
          const esImportRe =
            /import\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/g
          let m: RegExpExecArray | null
          while ((m = esImportRe.exec(content)) !== null) {
            const spec = m[1]
            const lineText = m[0]

            // extract imported names
            const namesMatch = lineText.match(/\{([^}]+)\}/)
            const defaultMatch = lineText.match(/import\s+(\w+)/)
            const names: string[] = []
            if (namesMatch) {
              names.push(
                ...namesMatch[1].split(',').map((n) =>
                  n.trim().replace(/\s+as\s+\w+/, ''),
                ),
              )
            }
            if (defaultMatch && defaultMatch[1] !== 'type') {
              names.push(defaultMatch[1])
            }

            let resolved: string | null = null
            if (spec.startsWith('.')) {
              const tryExts = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']
              for (const tryExt of tryExts) {
                const candidate = resolve(dir, spec + tryExt)
                if (existsSync(candidate)) {
                  resolved = relative(ctx.cwd, candidate)
                  break
                }
              }
            }

            deps.push({ raw: spec, resolved, names })
          }

          // CommonJS require
          const requireRe = /(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
          while ((m = requireRe.exec(content)) !== null) {
            const spec = m[1]
            let resolved: string | null = null
            if (spec.startsWith('.')) {
              const tryExts = ['', '.js', '.ts', '.json', '/index.js', '/index.ts']
              for (const tryExt of tryExts) {
                const candidate = resolve(dir, spec + tryExt)
                if (existsSync(candidate)) {
                  resolved = relative(ctx.cwd, candidate)
                  break
                }
              }
            }
            const namesMatch = m[0].match(/(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))/)
            const names: string[] = []
            if (namesMatch?.[1]) {
              names.push(...namesMatch[1].split(',').map((n) => n.trim()))
            } else if (namesMatch?.[2]) {
              names.push(namesMatch[2])
            }
            deps.push({ raw: spec, resolved, names })
          }

          // Python import / from ... import
          if (ext === '.py') {
            const pyImportRe = /^(?:from\s+([\w.]+)\s+import\s+([^#\n]+)|import\s+([\w., ]+))/gm
            while ((m = pyImportRe.exec(content)) !== null) {
              if (m[1]) {
                const names = m[2].split(',').map((n) => n.trim().replace(/\s+as\s+\w+/, ''))
                deps.push({ raw: m[1], resolved: null, names })
              } else if (m[3]) {
                const mods = m[3].split(',').map((n) => n.trim())
                for (const mod of mods) {
                  deps.push({ raw: mod, resolved: null, names: [mod.split('.').pop()!] })
                }
              }
            }
          }

          // Rust use
          if (ext === '.rs') {
            const useRe = /^use\s+([\w:]+(?:::\{[^}]+\})?)\s*;/gm
            while ((m = useRe.exec(content)) !== null) {
              deps.push({ raw: m[1], resolved: null, names: [] })
            }
          }

          // Go import
          if (ext === '.go') {
            const goImportBlockRe = /import\s*\(([^)]*(?:\n[^)]*)*)\)/g
            const goImportSingleRe = /import\s+"([^"]+)"/g
            while ((m = goImportBlockRe.exec(content)) !== null) {
              const block = m[1]
              const lineRe = /"([^"]+)"/g
              let lm: RegExpExecArray | null
              while ((lm = lineRe.exec(block)) !== null) {
                deps.push({ raw: lm[1], resolved: null, names: [] })
              }
            }
            while ((m = goImportSingleRe.exec(content)) !== null) {
              deps.push({ raw: m[1], resolved: null, names: [] })
            }
          }

          if (deps.length === 0) return ok('No imports or dependencies found.')

          const rel = relative(ctx.cwd, file)
          const lines: string[] = [`Dependencies of ${rel} (${deps.length}):\n`]
          for (const dep of deps) {
            const resolvedStr = dep.resolved ? ` → ${dep.resolved}` : ''
            const namesStr = dep.names.length ? ` {${dep.names.join(', ')}}` : ''
            lines.push(`  ${dep.raw}${resolvedStr}${namesStr}`)
          }
          return ok(lines.join('\n'))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 5. lint_check --------------------------------------------------------
    {
      definition: {
        name: 'lint_check',
        description:
          'Run basic static analysis checks on a file: unused imports, console.log, TODO/FIXME, long lines, deep nesting.',
        category: 'code-analysis',
        input_schema: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'File to check.',
            },
          },
          required: ['file'],
        },
      },
      handler(input, ctx) {
        try {
          const file = resolve(ctx.cwd, input.file as string)
          const content = readText(file)
          const lines = content.split('\n')
          const rel = relative(ctx.cwd, file)
          const ext = extname(file).toLowerCase()

          interface Warning {
            line: number
            kind: string
            message: string
          }
          const warnings: Warning[] = []

          // 1) Console.log statements
          const consoleRe = /\bconsole\.(log|debug|info|warn|error|trace)\s*\(/
          for (let i = 0; i < lines.length; i++) {
            if (consoleRe.test(lines[i])) {
              warnings.push({ line: i + 1, kind: 'console', message: `console statement: ${lines[i].trim().slice(0, 80)}` })
            }
          }

          // 2) TODO / FIXME / HACK comments
          const todoRe = /\b(TODO|FIXME|HACK|XXX|TEMP)\b/i
          for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(todoRe)
            if (m) {
              warnings.push({ line: i + 1, kind: 'todo', message: `${m[1].toUpperCase()}: ${lines[i].trim().slice(0, 80)}` })
            }
          }

          // 3) Very long lines (>200 chars)
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].length > 200) {
              warnings.push({ line: i + 1, kind: 'long-line', message: `Line is ${lines[i].length} chars (>200)` })
            }
          }

          // 4) Deep nesting (>5 levels) — count leading brace/indent depth
          if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.java', '.cs', '.rs', '.go', '.c', '.cpp'].includes(ext)) {
            let depth = 0
            for (let i = 0; i < lines.length; i++) {
              for (const ch of lines[i]) {
                if (ch === '{') depth++
                if (ch === '}') depth--
              }
              if (depth > 5) {
                warnings.push({ line: i + 1, kind: 'deep-nesting', message: `Nesting depth ${depth} (>5)` })
              }
            }
          }

          // 5) Potentially unused imports (TS/JS only — simple heuristic)
          if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
            const importLines: Array<{ lineNum: number; names: string[] }> = []
            const importRe = /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+/
            for (let i = 0; i < lines.length; i++) {
              const m = lines[i].match(importRe)
              if (!m) continue
              const names: string[] = []
              if (m[1]) {
                names.push(
                  ...m[1]
                    .split(',')
                    .map((n) => n.trim().replace(/\s+as\s+(\w+)/, '$1'))
                    .filter(Boolean),
                )
              }
              if (m[2]) names.push(m[2])
              if (m[3]) {
                names.push(
                  ...m[3]
                    .split(',')
                    .map((n) => n.trim().replace(/\s+as\s+(\w+)/, '$1'))
                    .filter(Boolean),
                )
              }
              importLines.push({ lineNum: i + 1, names })
            }

            // Check if the imported names appear elsewhere in the file
            const rest = lines.join('\n')
            for (const imp of importLines) {
              for (const name of imp.names) {
                // Simple check: if the name only appears on the import line, it's likely unused
                const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                const allOccurrences = rest.match(new RegExp(`\\b${escapedName}\\b`, 'g'))
                if (allOccurrences && allOccurrences.length <= 1) {
                  warnings.push({ line: imp.lineNum, kind: 'unused-import', message: `Possibly unused import: "${name}"` })
                }
              }
            }
          }

          if (warnings.length === 0) return ok(`✓ ${rel}: No lint warnings found.`)

          // Group by kind
          const grouped: Record<string, Warning[]> = {}
          for (const w of warnings) {
            ;(grouped[w.kind] ??= []).push(w)
          }

          const output: string[] = [`${rel}: ${warnings.length} warning(s)\n`]
          for (const [kind, ws] of Object.entries(grouped)) {
            output.push(`[${kind}] (${ws.length})`)
            for (const w of ws) {
              output.push(`  L${w.line}: ${w.message}`)
            }
            output.push('')
          }
          return ok(output.join('\n'))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 6. ast_outline -------------------------------------------------------
    {
      definition: {
        name: 'ast_outline',
        description:
          'Get a structured outline of a source file: exports, functions (with params), classes (with methods), interfaces, type aliases.',
        category: 'code-analysis',
        input_schema: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'Source file to outline.',
            },
          },
          required: ['file'],
        },
      },
      handler(input, ctx) {
        try {
          const file = resolve(ctx.cwd, input.file as string)
          const content = readText(file)
          const ext = extname(file).toLowerCase()
          const rel = relative(ctx.cwd, file)
          const lines = content.split('\n')

          const outline: string[] = [`Outline of ${rel}\n`]

          // Exports
          const exports: string[] = []
          const exportRe = /^export\s+(?:default\s+)?(?:const|let|var|function|async\s+function|class|interface|type|enum)\s+(\w+)/gm
          let m: RegExpExecArray | null
          while ((m = exportRe.exec(content)) !== null) {
            exports.push(m[1])
          }
          // export { ... }
          const reExportBrace = /^export\s*\{([^}]+)\}/gm
          while ((m = reExportBrace.exec(content)) !== null) {
            exports.push(...m[1].split(',').map((n) => n.trim().replace(/\s+as\s+\w+/, '')).filter(Boolean))
          }
          if (exports.length) {
            outline.push(`Exports (${exports.length}): ${exports.join(', ')}\n`)
          }

          // Functions with params
          const fns: string[] = []
          if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
            const fnRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g
            while ((m = fnRe.exec(content)) !== null) {
              const lineNum = content.slice(0, m.index).split('\n').length
              const params = m[2].trim().replace(/\s+/g, ' ')
              fns.push(`  L${lineNum}: ${m[1]}(${params})`)
            }
            const arrowRe = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)/g
            while ((m = arrowRe.exec(content)) !== null) {
              const lineNum = content.slice(0, m.index).split('\n').length
              const params = m[2].trim().replace(/\s+/g, ' ')
              fns.push(`  L${lineNum}: ${m[1]}(${params})`)
            }
          } else if (ext === '.py') {
            const defRe = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm
            while ((m = defRe.exec(content)) !== null) {
              const lineNum = content.slice(0, m.index).split('\n').length
              const params = m[2].trim().replace(/\s+/g, ' ')
              fns.push(`  L${lineNum}: ${m[1]}(${params})`)
            }
          } else if (ext === '.rs') {
            const fnRe = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g
            while ((m = fnRe.exec(content)) !== null) {
              const lineNum = content.slice(0, m.index).split('\n').length
              const params = m[2].trim().replace(/\s+/g, ' ').slice(0, 80)
              fns.push(`  L${lineNum}: ${m[1]}(${params})`)
            }
          } else if (ext === '.go') {
            const fnRe = /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)/g
            while ((m = fnRe.exec(content)) !== null) {
              const lineNum = content.slice(0, m.index).split('\n').length
              const params = m[2].trim().replace(/\s+/g, ' ').slice(0, 80)
              fns.push(`  L${lineNum}: ${m[1]}(${params})`)
            }
          } else {
            // Generic fallback
            const fnRe = /(?:function|def|fn|func)\s+(\w+)\s*\(([^)]*)\)/g
            while ((m = fnRe.exec(content)) !== null) {
              const lineNum = content.slice(0, m.index).split('\n').length
              const params = m[2].trim().replace(/\s+/g, ' ').slice(0, 80)
              fns.push(`  L${lineNum}: ${m[1]}(${params})`)
            }
          }
          if (fns.length) {
            outline.push(`Functions (${fns.length}):`)
            outline.push(...fns)
            outline.push('')
          }

          // Classes with methods
          const classBlockRe = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)[^{]*\{/g
          while ((m = classBlockRe.exec(content)) !== null) {
            const className = m[1]
            const lineNum = content.slice(0, m.index).split('\n').length

            // Extract methods by scanning forward from class open brace
            const classStart = m.index + m[0].length
            let depth = 1
            let pos = classStart
            while (pos < content.length && depth > 0) {
              if (content[pos] === '{') depth++
              if (content[pos] === '}') depth--
              pos++
            }
            const classBody = content.slice(classStart, pos - 1)
            const methods: string[] = []
            const methodRe = /(?:(?:public|private|protected|static|async|readonly|abstract|override|get|set)\s+)*(\w+)\s*\(([^)]*)\)/g
            let mm: RegExpExecArray | null
            while ((mm = methodRe.exec(classBody)) !== null) {
              const name = mm[1]
              if (['if', 'for', 'while', 'switch', 'catch', 'new', 'return', 'throw', 'super'].includes(name)) continue
              const params = mm[2].trim().replace(/\s+/g, ' ').slice(0, 60)
              methods.push(`    ${name}(${params})`)
            }

            outline.push(`Class L${lineNum}: ${className}`)
            if (methods.length) {
              outline.push(...methods)
            }
            outline.push('')
          }

          // Interfaces
          const ifaceRe = /(?:export\s+)?interface\s+(\w+)/g
          const ifaces: string[] = []
          while ((m = ifaceRe.exec(content)) !== null) {
            const lineNum = content.slice(0, m.index).split('\n').length
            ifaces.push(`  L${lineNum}: ${m[1]}`)
          }
          if (ifaces.length) {
            outline.push(`Interfaces (${ifaces.length}):`)
            outline.push(...ifaces)
            outline.push('')
          }

          // Type aliases
          const typeRe = /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/g
          const types: string[] = []
          while ((m = typeRe.exec(content)) !== null) {
            const lineNum = content.slice(0, m.index).split('\n').length
            types.push(`  L${lineNum}: ${m[1]}`)
          }
          if (types.length) {
            outline.push(`Type Aliases (${types.length}):`)
            outline.push(...types)
            outline.push('')
          }

          // Summary line count
          outline.push(`Total lines: ${lines.length}`)

          return ok(outline.join('\n'))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 7. find_duplicates ---------------------------------------------------
    {
      definition: {
        name: 'find_duplicates',
        description:
          'Find duplicate or near-duplicate code blocks across files using hash-based comparison of normalized line sequences.',
        category: 'code-analysis',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory to scan.',
            },
            min_lines: {
              type: 'number',
              description: 'Minimum number of lines for a duplicate block.',
              default: 5,
            },
          },
          required: ['path'],
        },
      },
      handler(input, ctx) {
        try {
          const target = resolve(ctx.cwd, input.path as string)
          const minLines = (input.min_lines as number) ?? 5
          const files = walkFiles(target).filter(isSource)

          // For each file, normalize lines (trim, collapse whitespace) and
          // compute rolling hashes over windows of `minLines` lines.
          const hashMap = new Map<string, Array<{ file: string; startLine: number }>>()

          for (const file of files) {
            let content: string
            try {
              content = readText(file)
            } catch {
              continue
            }
            const rawLines = content.split('\n')
            // Normalize: trim, collapse whitespace, skip blanks
            const normalized: Array<{ text: string; origLine: number }> = []
            for (let i = 0; i < rawLines.length; i++) {
              const t = rawLines[i].trim().replace(/\s+/g, ' ')
              if (t.length > 0) {
                normalized.push({ text: t, origLine: i + 1 })
              }
            }

            if (normalized.length < minLines) continue

            const rel = relative(ctx.cwd, file)
            for (let i = 0; i <= normalized.length - minLines; i++) {
              const block = normalized
                .slice(i, i + minLines)
                .map((n) => n.text)
                .join('\n')
              const hash = createHash('sha256').update(block).digest('hex').slice(0, 16)
              const entry = { file: rel, startLine: normalized[i].origLine }
              const existing = hashMap.get(hash)
              if (existing) {
                existing.push(entry)
              } else {
                hashMap.set(hash, [entry])
              }
            }
          }

          // Filter to only duplicates (across different files or distant locations)
          const duplicates: Array<{ locations: Array<{ file: string; startLine: number }>; hash: string }> = []
          const seenFiles = new Set<string>()

          for (const [hash, locations] of Array.from(hashMap.entries())) {
            if (locations.length < 2) continue

            // Check if locations span different files or are far apart
            const uniqueFiles = new Set(locations.map((l) => l.file))
            const crossFile = uniqueFiles.size > 1
            const farApart =
              uniqueFiles.size === 1 &&
              locations.some(
                (a, i) =>
                  locations.some(
                    (b, j) => i !== j && Math.abs(a.startLine - b.startLine) > minLines * 2,
                  ),
              )

            if (crossFile || farApart) {
              // Deduplicate similar hash entries (only report first occurrence per file pair)
              const key = locations.map((l) => `${l.file}:${l.startLine}`).sort().join('|')
              if (!seenFiles.has(key)) {
                seenFiles.add(key)
                duplicates.push({ locations, hash })
              }
            }
          }

          if (duplicates.length === 0) {
            return ok(`No duplicate blocks (≥${minLines} lines) found across ${files.length} files.`)
          }

          // Limit output
          const maxShow = 50
          const shown = duplicates.slice(0, maxShow)
          const output: string[] = [
            `Found ${duplicates.length} duplicate block(s) (≥${minLines} lines) across ${files.length} files:\n`,
          ]

          for (let i = 0; i < shown.length; i++) {
            const d = shown[i]
            // Deduplicate locations
            const uniqueLocs = new Map<string, { file: string; startLine: number }>()
            for (const loc of d.locations) {
              const key = `${loc.file}:${loc.startLine}`
              if (!uniqueLocs.has(key)) uniqueLocs.set(key, loc)
            }
            const locs = Array.from(uniqueLocs.values())
            if (locs.length < 2) continue

            output.push(`#${i + 1} (${locs.length} occurrences):`)
            for (const loc of locs.slice(0, 5)) {
              output.push(`  ${loc.file}:${loc.startLine}`)
            }
            if (locs.length > 5) output.push(`  ... and ${locs.length - 5} more`)
            output.push('')
          }

          if (duplicates.length > maxShow) {
            output.push(`... and ${duplicates.length - maxShow} more duplicate groups.`)
          }

          return ok(output.join('\n'))
        } catch (err) {
          return fail(err)
        }
      },
    },
  ],
}
