/**
 * System tools — system info, processes, disk usage, clipboard, environment.
 */

import { execSync } from 'child_process'
import * as os from 'os'
import type { ToolCategory, ToolContext, ToolResult } from './registry'

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(result: string): ToolResult {
  return { result, isError: false }
}

function err(result: string): ToolResult {
  return { result, isError: true }
}

const isWindows = os.platform() === 'win32'
const isMac = os.platform() === 'darwin'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${mins}m`)
  return parts.join(' ')
}

// ── Sensitive env var filter ─────────────────────────────────────────────────

const SENSITIVE_PATTERNS = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASS', 'CREDENTIAL', 'AUTH']

function isSensitiveVar(name: string): boolean {
  const upper = name.toUpperCase()
  return SENSITIVE_PATTERNS.some((pat) => upper.includes(pat))
}

// ── Tool handlers ────────────────────────────────────────────────────────────

function systemInfoHandler(): ToolResult {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  const lines = [
    'System Information',
    '─'.repeat(40),
    `OS:          ${os.type()} ${os.release()} (${os.platform()})`,
    `Arch:        ${os.arch()}`,
    `Hostname:    ${os.hostname()}`,
    `CPUs:        ${cpus.length}x ${cpus[0]?.model ?? 'Unknown'}`,
    `Memory:      ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${((usedMem / totalMem) * 100).toFixed(1)}% used)`,
    `Free Memory: ${formatBytes(freeMem)}`,
    `Uptime:      ${formatUptime(os.uptime())}`,
    `Node.js:     ${process.version}`,
    `PID:         ${process.pid}`,
    `User:        ${os.userInfo().username}`,
    `Home Dir:    ${os.homedir()}`,
    `Temp Dir:    ${os.tmpdir()}`,
  ]

  return ok(lines.join('\n'))
}

function envVarsHandler(input: Record<string, unknown>): ToolResult {
  const name = input.name as string | undefined

  if (name) {
    const value = process.env[name]
    if (value === undefined) {
      return ok(`Environment variable "${name}" is not set.`)
    }
    // Even for specific lookups, warn if sensitive
    if (isSensitiveVar(name)) {
      return ok(`${name} = [REDACTED — sensitive variable]`)
    }
    return ok(`${name} = ${value}`)
  }

  // List all non-sensitive vars
  const env = process.env
  const keys = Object.keys(env).sort()
  const lines: string[] = [`Environment Variables (${keys.length} total, sensitive vars filtered):`, '']

  let shown = 0
  let hidden = 0

  for (const key of keys) {
    if (isSensitiveVar(key)) {
      hidden++
      continue
    }
    const val = env[key] ?? ''
    // Truncate long values
    const display = val.length > 120 ? val.slice(0, 120) + '...' : val
    lines.push(`  ${key} = ${display}`)
    shown++
  }

  lines.push('')
  lines.push(`Shown: ${shown} | Hidden (sensitive): ${hidden}`)

  return ok(lines.join('\n'))
}

async function processListHandler(input: Record<string, unknown>): Promise<ToolResult> {
  const filter = input.filter as string | undefined
  const sortBy = ((input.sort_by as string) ?? 'cpu').toLowerCase()
  const limit = (input.limit as number) ?? 20

  try {
    let output: string

    if (isWindows) {
      // tasklist /FO CSV gives structured output
      output = execSync(
        'powershell -Command "Get-Process | Sort-Object -Property CPU -Descending | Select-Object -First 100 Id, ProcessName, CPU, @{Name=\'MemMB\';Expression={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String -Width 200"',
        { encoding: 'utf-8', timeout: 10000 },
      )
    } else {
      output = execSync('ps aux --sort=-%cpu | head -101', {
        encoding: 'utf-8',
        timeout: 10000,
      })
    }

    let lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0)

    // Apply name filter
    if (filter) {
      const header = lines[0]
      const filterLower = filter.toLowerCase()
      lines = [header, ...lines.slice(1).filter((l) => l.toLowerCase().includes(filterLower))]
    }

    // Apply limit (keep header + limit rows)
    if (lines.length > limit + 1) {
      lines = [...lines.slice(0, limit + 1), `... (${lines.length - limit - 1} more)`]
    }

    return ok(lines.join('\n'))
  } catch (e) {
    return err(`Error listing processes: ${(e as Error).message}`)
  }
}

async function diskUsageHandler(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const targetPath = (input.path as string) ?? '.'

  try {
    let output: string

    if (isWindows) {
      // Use PowerShell to get drive info
      const resolved = require('path').resolve(context.cwd, targetPath)
      const drive = resolved.slice(0, 2) // e.g., "C:"
      output = execSync(
        `powershell -Command "Get-PSDrive -Name '${drive[0]}' | Select-Object Name, @{N='UsedGB';E={[math]::Round($_.Used/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}}, @{N='TotalGB';E={[math]::Round(($_.Used+$_.Free)/1GB,2)}} | Format-List | Out-String"`,
        { encoding: 'utf-8', timeout: 10000 },
      )
    } else {
      const resolved = require('path').resolve(context.cwd, targetPath)
      output = execSync(`df -h "${resolved}"`, { encoding: 'utf-8', timeout: 10000 })
    }

    return ok(`Disk usage for "${targetPath}":\n\n${output.trim()}`)
  } catch (e) {
    return err(`Error getting disk usage: ${(e as Error).message}`)
  }
}

function networkInfoHandler(): ToolResult {
  const interfaces = os.networkInterfaces()
  const lines: string[] = ['Network Interfaces:', '']

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue

    lines.push(`  ${name}:`)
    for (const addr of addrs) {
      const scope = addr.internal ? ' (internal)' : ''
      lines.push(`    ${addr.family}: ${addr.address}${scope}`)
      if (addr.mac && addr.mac !== '00:00:00:00:00:00') {
        lines.push(`    MAC: ${addr.mac}`)
      }
      if (addr.netmask) {
        lines.push(`    Netmask: ${addr.netmask}`)
      }
    }
    lines.push('')
  }

  return ok(lines.join('\n'))
}

function killProcessHandler(input: Record<string, unknown>): ToolResult {
  const pid = input.pid as number
  const signal = (input.signal as string) ?? 'SIGTERM'

  // Safety checks
  if (pid === 1) {
    return err('Refusing to kill PID 1 (init/system process).')
  }

  if (pid === process.pid) {
    return err('Refusing to kill the current process (self).')
  }

  if (pid <= 0) {
    return err('Invalid PID. Must be a positive integer.')
  }

  try {
    // Map string signal names to NodeJS signals
    const sig = signal as NodeJS.Signals
    process.kill(pid, sig)
    return ok(`Signal ${signal} sent to process ${pid}.`)
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    if (error.code === 'ESRCH') {
      return err(`Process ${pid} not found.`)
    }
    if (error.code === 'EPERM') {
      return err(`Permission denied to signal process ${pid}.`)
    }
    return err(`Failed to kill process ${pid}: ${error.message}`)
  }
}

function openUrlHandler(input: Record<string, unknown>): ToolResult {
  const url = input.url as string

  try {
    if (isWindows) {
      execSync(`start "" "${url}"`, { stdio: 'ignore', shell: 'cmd.exe' })
    } else if (isMac) {
      execSync(`open "${url}"`, { stdio: 'ignore' })
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' })
    }

    return ok(`Opened ${url} in default browser.`)
  } catch (e) {
    return err(`Failed to open URL: ${(e as Error).message}`)
  }
}

function clipboardHandler(input: Record<string, unknown>): ToolResult {
  const action = input.action as string
  const content = input.content as string | undefined

  if (action === 'write') {
    if (!content && content !== '') {
      return err('Content is required for clipboard write.')
    }

    try {
      if (isWindows) {
        execSync(`powershell -Command "Set-Clipboard -Value '${content.replace(/'/g, "''")}'`, {
          encoding: 'utf-8',
          timeout: 5000,
        })
      } else if (isMac) {
        execSync(`echo ${JSON.stringify(content)} | pbcopy`, {
          encoding: 'utf-8',
          timeout: 5000,
          shell: '/bin/bash',
        })
      } else {
        execSync(`echo ${JSON.stringify(content)} | xclip -selection clipboard`, {
          encoding: 'utf-8',
          timeout: 5000,
          shell: '/bin/bash',
        })
      }

      return ok(`Copied ${content.length} characters to clipboard.`)
    } catch (e) {
      return err(`Failed to write to clipboard: ${(e as Error).message}`)
    }
  }

  if (action === 'read') {
    try {
      let text: string

      if (isWindows) {
        text = execSync('powershell -Command "Get-Clipboard"', {
          encoding: 'utf-8',
          timeout: 5000,
        }).trim()
      } else if (isMac) {
        text = execSync('pbpaste', { encoding: 'utf-8', timeout: 5000 }).trim()
      } else {
        text = execSync('xclip -selection clipboard -o', {
          encoding: 'utf-8',
          timeout: 5000,
        }).trim()
      }

      return ok(text || '(clipboard is empty)')
    } catch (e) {
      return err(`Failed to read clipboard: ${(e as Error).message}`)
    }
  }

  return err(`Invalid action "${action}". Use "read" or "write".`)
}

// ── Category export ──────────────────────────────────────────────────────────

export const systemTools: ToolCategory = {
  name: 'system',
  description: 'System information and management tools — processes, disk, network, clipboard',
  tools: [
    {
      definition: {
        name: 'system_info',
        description:
          'Get system information including OS, architecture, CPU, memory, uptime, and Node.js version.',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler: systemInfoHandler,
    },
    {
      definition: {
        name: 'env_vars',
        description:
          'List or get environment variables. When listing all, sensitive variables (containing KEY, SECRET, TOKEN, PASSWORD) are filtered out.',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Specific variable name to look up. If omitted, lists all non-sensitive variables.',
            },
          },
          required: [],
        },
      },
      handler: envVarsHandler,
    },
    {
      definition: {
        name: 'process_list',
        description:
          'List running processes with CPU and memory usage. Supports filtering by name and sorting.',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Filter processes by name (case-insensitive substring match)',
            },
            sort_by: {
              type: 'string',
              enum: ['cpu', 'memory', 'name'],
              description: 'Sort by cpu, memory, or name (default "cpu")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of processes to show (default 20)',
            },
          },
          required: [],
        },
      },
      handler: processListHandler,
    },
    {
      definition: {
        name: 'disk_usage',
        description:
          'Show disk usage for a path, including total, used, and available space.',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to check disk usage for (default "." — current directory)',
            },
          },
          required: [],
        },
      },
      handler: diskUsageHandler,
    },
    {
      definition: {
        name: 'network_info',
        description:
          'Show network interfaces with IP addresses, MAC addresses, and netmasks.',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler: networkInfoHandler,
    },
    {
      definition: {
        name: 'kill_process',
        description:
          'Kill a process by PID. Safety checks prevent killing PID 1 or the current process.',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {
            pid: { type: 'number', description: 'Process ID to kill' },
            signal: {
              type: 'string',
              description: 'Signal to send (default "SIGTERM"). Common: SIGTERM, SIGKILL, SIGINT.',
            },
          },
          required: ['pid'],
        },
      },
      handler: killProcessHandler,
    },
    {
      definition: {
        name: 'open_url',
        description:
          'Open a URL in the default system browser. Works on Windows (start), macOS (open), and Linux (xdg-open).',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to open in the browser' },
          },
          required: ['url'],
        },
      },
      handler: openUrlHandler,
    },
    {
      definition: {
        name: 'clipboard',
        description:
          'Read from or write to the system clipboard. Uses PowerShell on Windows, pbcopy/pbpaste on macOS, xclip on Linux.',
        category: 'system',
        input_schema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['read', 'write'],
              description: 'Whether to read from or write to the clipboard',
            },
            content: {
              type: 'string',
              description: 'Content to write to the clipboard (required when action is "write")',
            },
          },
          required: ['action'],
        },
      },
      handler: clipboardHandler,
    },
  ],
}

export default systemTools
