/**
 * Web & Network tools — fetch URLs, HTTP requests, DNS, port checks, screenshots.
 */

import { execSync } from 'child_process'
import * as dns from 'dns/promises'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { ToolCategory, ToolContext, ToolResult } from './registry'

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(result: string): ToolResult {
  return { result, isError: false }
}

function err(result: string): ToolResult {
  return { result, isError: true }
}

/** Convert HTML to readable plain text */
function htmlToText(html: string): string {
  let text = html

  // Remove scripts, styles, head
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '')

  // Convert common elements
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
  text = text.replace(/<(h[1-6])[^>]*>/gi, '\n## ')
  text = text.replace(/<li[^>]*>/gi, '• ')

  // Extract link text
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)))

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()

  return text
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function fetchUrlHandler(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input.url as string
  const maxLength = (input.max_length as number) ?? 50000

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Squan-Agent/0.4.0 (https://squan.dev)',
        Accept: 'text/html,application/json,text/plain,*/*',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      return err(`HTTP ${response.status} ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('json')) {
      const text = await response.text()
      return ok(text.slice(0, maxLength))
    }

    if (contentType.includes('text/plain')) {
      const text = await response.text()
      return ok(text.slice(0, maxLength))
    }

    // HTML — strip tags for readability
    const html = await response.text()
    return ok(htmlToText(html).slice(0, maxLength))
  } catch (e) {
    return err(`Error fetching ${url}: ${(e as Error).message}`)
  }
}

async function searchWebHandler(input: Record<string, unknown>): Promise<ToolResult> {
  const query = input.query as string
  const maxResults = (input.max_results as number) ?? 5

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Squan-Agent/0.4.0' },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return err(`Search failed: HTTP ${response.status}`)

    const data = (await response.json()) as any
    const results: string[] = []

    if (data.Abstract) {
      results.push(`## ${data.Heading || query}`)
      results.push(data.Abstract)
      if (data.AbstractURL) results.push(`Source: ${data.AbstractURL}`)
      results.push('')
    }

    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, maxResults)) {
        if (topic.Text) {
          results.push(`• ${topic.Text}`)
          if (topic.FirstURL) results.push(`  ${topic.FirstURL}`)
        }
      }
    }

    if (data.Answer) {
      results.push(`Answer: ${data.Answer}`)
    }

    return ok(results.length > 0 ? results.join('\n') : `No results found for: ${query}`)
  } catch (e) {
    return err(`Search error: ${(e as Error).message}`)
  }
}

async function httpRequestHandler(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input.url as string
  const method = ((input.method as string) ?? 'GET').toUpperCase()
  const headers = (input.headers as Record<string, string>) ?? {}
  const body = input.body as string | undefined
  const timeoutMs = (input.timeout_ms as number) ?? 15000

  try {
    const init: RequestInit = {
      method,
      headers: {
        'User-Agent': 'Squan-Agent/0.4.0',
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    }

    if (body && method !== 'GET' && method !== 'HEAD') {
      init.body = body
    }

    const response = await fetch(url, init)
    const responseBody = await response.text()

    const respHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      respHeaders[k] = v
    })

    const output = [
      `Status: ${response.status} ${response.statusText}`,
      `Headers: ${JSON.stringify(respHeaders, null, 2)}`,
      `Body:\n${responseBody.slice(0, 100000)}`,
    ].join('\n\n')

    return ok(output)
  } catch (e) {
    return err(`HTTP request failed: ${(e as Error).message}`)
  }
}

async function downloadFileHandler(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const url = input.url as string
  const destination = path.resolve(context.cwd, input.destination as string)
  const overwrite = (input.overwrite as boolean) ?? false

  try {
    if (!overwrite && fs.existsSync(destination)) {
      return err(`File already exists: ${destination}. Set overwrite=true to replace.`)
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(destination), { recursive: true })

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Squan-Agent/0.4.0' },
      signal: AbortSignal.timeout(120000),
    })

    if (!response.ok) {
      return err(`Download failed: HTTP ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    const sizeInfo = contentLength ? ` (${(parseInt(contentLength) / 1024).toFixed(1)} KB)` : ''

    if (!response.body) {
      return err('Response body is empty')
    }

    const fileStream = fs.createWriteStream(destination)
    // Convert web ReadableStream to Node Readable
    const nodeStream = Readable.fromWeb(response.body as any)
    await pipeline(nodeStream, fileStream)

    const stat = fs.statSync(destination)
    return ok(
      `Downloaded ${url}${sizeInfo} → ${destination}\nFinal size: ${(stat.size / 1024).toFixed(1)} KB`,
    )
  } catch (e) {
    return err(`Download error: ${(e as Error).message}`)
  }
}

async function dnsLookupHandler(input: Record<string, unknown>): Promise<ToolResult> {
  const domain = input.domain as string
  const type = ((input.type as string) ?? 'A').toUpperCase()

  try {
    let records: any

    switch (type) {
      case 'A':
        records = await dns.resolve4(domain)
        break
      case 'AAAA':
        records = await dns.resolve6(domain)
        break
      case 'MX':
        records = await dns.resolveMx(domain)
        records = records.map((r: any) => `${r.priority} ${r.exchange}`)
        break
      case 'TXT':
        records = await dns.resolveTxt(domain)
        records = records.map((r: any) => r.join(''))
        break
      case 'NS':
        records = await dns.resolveNs(domain)
        break
      case 'CNAME':
        records = await dns.resolveCname(domain)
        break
      default:
        return err(`Unsupported DNS record type: ${type}`)
    }

    const lines = [`DNS ${type} records for ${domain}:`, '']
    if (Array.isArray(records)) {
      for (const r of records) {
        lines.push(`  ${typeof r === 'string' ? r : JSON.stringify(r)}`)
      }
    }

    return ok(lines.join('\n'))
  } catch (e) {
    return err(`DNS lookup failed for ${domain}: ${(e as Error).message}`)
  }
}

async function urlScreenshotHandler(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input.url as string
  const outputPath = input.output_path as string
  const width = (input.width as number) ?? 1280
  const height = (input.height as number) ?? 720

  // Try to find Chrome/Edge
  const browsers = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]

  let browserPath: string | null = null
  for (const bp of browsers) {
    if (fs.existsSync(bp)) {
      browserPath = bp
      break
    }
  }

  if (!browserPath) {
    return err('No Chrome or Edge installation found. Install Chrome or Edge to use screenshots.')
  }

  try {
    const resolvedOutput = path.resolve(outputPath)
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true })

    const cmd = `"${browserPath}" --headless --disable-gpu --no-sandbox --screenshot="${resolvedOutput}" --window-size=${width},${height} "${url}"`
    execSync(cmd, { timeout: 30000, stdio: 'pipe' })

    if (fs.existsSync(resolvedOutput)) {
      const stat = fs.statSync(resolvedOutput)
      return ok(`Screenshot saved to ${resolvedOutput} (${(stat.size / 1024).toFixed(1)} KB)`)
    } else {
      return err('Screenshot command ran but output file was not created.')
    }
  } catch (e) {
    return err(`Screenshot failed: ${(e as Error).message}`)
  }
}

async function checkPortHandler(input: Record<string, unknown>): Promise<ToolResult> {
  const host = input.host as string
  const port = input.port as number
  const timeoutMs = (input.timeout_ms as number) ?? 3000

  return new Promise<ToolResult>((resolve) => {
    const socket = new net.Socket()
    let resolved = false

    const done = (result: ToolResult) => {
      if (resolved) return
      resolved = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)

    socket.on('connect', () => {
      done(ok(`Port ${port} on ${host} is OPEN`))
    })

    socket.on('timeout', () => {
      done(ok(`Port ${port} on ${host} is CLOSED (timeout after ${timeoutMs}ms)`))
    })

    socket.on('error', (e: Error) => {
      if ((e as any).code === 'ECONNREFUSED') {
        done(ok(`Port ${port} on ${host} is CLOSED (connection refused)`))
      } else {
        done(err(`Port check failed: ${e.message}`))
      }
    })

    socket.connect(port, host)
  })
}

// ── Category export ──────────────────────────────────────────────────────────

export const networkTools: ToolCategory = {
  name: 'network',
  description: 'Web and network tools — fetch URLs, HTTP requests, DNS lookups, port checks, screenshots',
  tools: [
    {
      definition: {
        name: 'fetch_url',
        description:
          'Fetch a URL and return content as text. HTML is automatically converted to plain text for readability.',
        category: 'network',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch' },
            max_length: {
              type: 'number',
              description: 'Maximum length of returned text (default 50000)',
            },
          },
          required: ['url'],
        },
      },
      handler: fetchUrlHandler,
    },
    {
      definition: {
        name: 'search_web',
        description: 'Search the web using DuckDuckGo API. Returns relevant results with snippets and URLs.',
        category: 'network',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default 5)',
            },
          },
          required: ['query'],
        },
      },
      handler: searchWebHandler,
    },
    {
      definition: {
        name: 'http_request',
        description:
          'Make an arbitrary HTTP request. Returns status code, response headers, and body.',
        category: 'network',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to request' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method (default GET)',
            },
            headers: {
              type: 'object',
              description: 'Request headers as key-value pairs',
              additionalProperties: { type: 'string' },
            },
            body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
            timeout_ms: {
              type: 'number',
              description: 'Request timeout in milliseconds (default 15000)',
            },
          },
          required: ['url'],
        },
      },
      handler: httpRequestHandler,
    },
    {
      definition: {
        name: 'download_file',
        description:
          'Download a file from a URL to a local path. Shows file size information on completion.',
        category: 'network',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL of the file to download' },
            destination: { type: 'string', description: 'Local file path to save to' },
            overwrite: {
              type: 'boolean',
              description: 'Overwrite if file already exists (default false)',
            },
          },
          required: ['url', 'destination'],
        },
      },
      handler: downloadFileHandler,
    },
    {
      definition: {
        name: 'dns_lookup',
        description: 'Perform a DNS lookup for a domain name. Supports A, AAAA, MX, TXT, NS, and CNAME record types.',
        category: 'network',
        input_schema: {
          type: 'object',
          properties: {
            domain: { type: 'string', description: 'Domain name to look up' },
            type: {
              type: 'string',
              enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'],
              description: 'DNS record type (default A)',
            },
          },
          required: ['domain'],
        },
      },
      handler: dnsLookupHandler,
    },
    {
      definition: {
        name: 'url_screenshot',
        description:
          'Take a screenshot of a URL using headless Chrome or Edge. Requires Chrome or Edge to be installed.',
        category: 'network',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to screenshot' },
            output_path: { type: 'string', description: 'File path to save the screenshot PNG' },
            width: { type: 'number', description: 'Viewport width in pixels (default 1280)' },
            height: { type: 'number', description: 'Viewport height in pixels (default 720)' },
          },
          required: ['url', 'output_path'],
        },
      },
      handler: urlScreenshotHandler,
    },
    {
      definition: {
        name: 'check_port',
        description: 'Check if a TCP port is open on a host. Returns whether the port is open or closed.',
        category: 'network',
        input_schema: {
          type: 'object',
          properties: {
            host: { type: 'string', description: 'Hostname or IP address' },
            port: { type: 'number', description: 'TCP port number to check' },
            timeout_ms: {
              type: 'number',
              description: 'Connection timeout in milliseconds (default 3000)',
            },
          },
          required: ['host', 'port'],
        },
      },
      handler: checkPortHandler,
    },
  ],
}

export default networkTools
