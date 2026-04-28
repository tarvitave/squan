/**
 * Database tools — SQLite queries, table inspection, CSV querying.
 */

import { createClient, type Client } from '@libsql/client'
import * as fs from 'fs'
import * as path from 'path'
import type { ToolCategory, ToolContext, ToolResult } from './registry'

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(result: string): ToolResult {
  return { result, isError: false }
}

function err(result: string): ToolResult {
  return { result, isError: true }
}

/** Create a libsql client for a local SQLite file */
function createSqliteClient(dbPath: string, cwd: string): Client {
  const resolved = path.resolve(cwd, dbPath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Database file not found: ${resolved}`)
  }
  return createClient({ url: `file:${resolved}` })
}

/** Format result rows into a readable table string */
function formatTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '(no rows returned)'

  // Calculate column widths
  const widths: number[] = columns.map((col) => col.length)
  for (const row of rows) {
    for (let i = 0; i < columns.length; i++) {
      const val = String(row[columns[i]] ?? 'NULL')
      widths[i] = Math.max(widths[i], val.length)
    }
  }

  // Cap column widths at 60 chars
  const maxWidth = 60
  const cappedWidths = widths.map((w) => Math.min(w, maxWidth))

  // Build header
  const header = columns.map((col, i) => col.padEnd(cappedWidths[i])).join(' | ')
  const separator = cappedWidths.map((w) => '-'.repeat(w)).join('-+-')

  // Build rows
  const rowLines = rows.map((row) =>
    columns
      .map((col, i) => {
        const val = String(row[col] ?? 'NULL')
        return val.length > maxWidth ? val.slice(0, maxWidth - 3) + '...' : val.padEnd(cappedWidths[i])
      })
      .join(' | '),
  )

  return [header, separator, ...rowLines].join('\n')
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function querySqliteHandler(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const dbPath = input.database as string
  const query = input.query as string
  const params = (input.params as unknown[]) ?? []

  let client: Client | null = null
  try {
    client = createSqliteClient(dbPath, context.cwd)

    const result = await client.execute({ sql: query, args: params as any })

    if (!result.columns || result.columns.length === 0) {
      // Non-SELECT query (INSERT, UPDATE, DELETE, etc.)
      return ok(`Query executed successfully. Rows affected: ${result.rowsAffected}`)
    }

    const columns = result.columns
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i]
      }
      return obj
    })

    const table = formatTable(columns, rows)
    return ok(`${rows.length} row(s) returned:\n\n${table}`)
  } catch (e) {
    return err(`SQLite query error: ${(e as Error).message}`)
  } finally {
    client?.close()
  }
}

async function listTablesHandler(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const database = input.database as string
  const type = ((input.type as string) ?? 'sqlite').toLowerCase()

  if (type === 'postgres') {
    return err(
      'PostgreSQL support requires the "pg" module which is not installed. ' +
        'Install it with: npm install pg',
    )
  }

  if (type !== 'sqlite') {
    return err(`Unsupported database type: ${type}. Supported: sqlite, postgres`)
  }

  let client: Client | null = null
  try {
    client = createSqliteClient(database, context.cwd)

    const result = await client.execute(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )

    if (result.rows.length === 0) {
      return ok('No tables or views found in the database.')
    }

    const lines: string[] = ['Tables and views:']
    for (const row of result.rows) {
      const name = row[0] as string
      const objType = row[1] as string

      // Get row count for tables
      if (objType === 'table') {
        try {
          const countResult = await client.execute(`SELECT COUNT(*) as cnt FROM "${name}"`)
          const count = countResult.rows[0][0]
          lines.push(`  [TABLE] ${name} (${count} rows)`)
        } catch {
          lines.push(`  [TABLE] ${name}`)
        }
      } else {
        lines.push(`  [VIEW]  ${name}`)
      }
    }

    return ok(lines.join('\n'))
  } catch (e) {
    return err(`Error listing tables: ${(e as Error).message}`)
  } finally {
    client?.close()
  }
}

async function describeTableHandler(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const database = input.database as string
  const table = input.table as string
  const type = ((input.type as string) ?? 'sqlite').toLowerCase()

  if (type === 'postgres') {
    return err(
      'PostgreSQL support requires the "pg" module which is not installed. ' +
        'Install it with: npm install pg',
    )
  }

  if (type !== 'sqlite') {
    return err(`Unsupported database type: ${type}. Supported: sqlite, postgres`)
  }

  let client: Client | null = null
  try {
    client = createSqliteClient(database, context.cwd)

    // Get column info
    const pragma = await client.execute(`PRAGMA table_info("${table}")`)

    if (pragma.rows.length === 0) {
      return err(`Table "${table}" not found or has no columns.`)
    }

    const lines: string[] = [`Schema for table "${table}":`, '']

    // Columns: cid, name, type, notnull, dflt_value, pk
    lines.push('Columns:')
    for (const row of pragma.rows) {
      const name = row[1] as string
      const colType = (row[2] as string) || 'ANY'
      const notNull = row[3] as number
      const defaultVal = row[4]
      const pk = row[5] as number

      const parts = [`  ${name} ${colType}`]
      if (pk) parts.push('PRIMARY KEY')
      if (notNull) parts.push('NOT NULL')
      if (defaultVal !== null && defaultVal !== undefined) parts.push(`DEFAULT ${defaultVal}`)
      lines.push(parts.join(' '))
    }

    // Get indexes
    try {
      const indexes = await client.execute(`PRAGMA index_list("${table}")`)
      if (indexes.rows.length > 0) {
        lines.push('')
        lines.push('Indexes:')
        for (const idx of indexes.rows) {
          const idxName = idx[1] as string
          const unique = idx[2] as number
          const idxInfo = await client.execute(`PRAGMA index_info("${idxName}")`)
          const cols = idxInfo.rows.map((r) => r[2] as string).join(', ')
          lines.push(`  ${idxName}${unique ? ' (UNIQUE)' : ''}: ${cols}`)
        }
      }
    } catch {
      // Index info not critical
    }

    // Get foreign keys
    try {
      const fks = await client.execute(`PRAGMA foreign_key_list("${table}")`)
      if (fks.rows.length > 0) {
        lines.push('')
        lines.push('Foreign keys:')
        for (const fk of fks.rows) {
          const refTable = fk[2] as string
          const from = fk[3] as string
          const to = fk[4] as string
          lines.push(`  ${from} → ${refTable}(${to})`)
        }
      }
    } catch {
      // FK info not critical
    }

    return ok(lines.join('\n'))
  } catch (e) {
    return err(`Error describing table: ${(e as Error).message}`)
  } finally {
    client?.close()
  }
}

async function queryCsvHandler(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const filePath = path.resolve(context.cwd, input.file as string)
  const query = (input.query as string) ?? 'SELECT *'

  try {
    if (!fs.existsSync(filePath)) {
      return err(`CSV file not found: ${filePath}`)
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)

    if (lines.length === 0) {
      return err('CSV file is empty.')
    }

    // Parse header
    const headers = parseCsvLine(lines[0])

    // Parse data rows
    const rows: Record<string, string>[] = []
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i])
      const row: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] ?? ''
      }
      rows.push(row)
    }

    // Parse and apply the query
    let filtered = [...rows]
    const upperQuery = query.toUpperCase()

    // Extract WHERE clause
    const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s*$)/i)
    if (whereMatch) {
      const condition = whereMatch[1].trim()
      filtered = applyWhere(filtered, condition)
    }

    // Extract ORDER BY clause
    const orderMatch = query.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i)
    if (orderMatch) {
      const col = orderMatch[1]
      const desc = (orderMatch[2] ?? 'ASC').toUpperCase() === 'DESC'
      filtered.sort((a, b) => {
        const va = a[col] ?? ''
        const vb = b[col] ?? ''
        const na = parseFloat(va)
        const nb = parseFloat(vb)
        if (!isNaN(na) && !isNaN(nb)) {
          return desc ? nb - na : na - nb
        }
        return desc ? vb.localeCompare(va) : va.localeCompare(vb)
      })
    }

    // Extract LIMIT clause
    const limitMatch = query.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      filtered = filtered.slice(0, parseInt(limitMatch[1]))
    }

    // Determine which columns to show
    let selectedCols = headers
    const selectMatch = query.match(/SELECT\s+(.+?)\s+(?:FROM|WHERE|ORDER|LIMIT|$)/i)
    if (selectMatch) {
      const selectPart = selectMatch[1].trim()
      if (selectPart !== '*') {
        selectedCols = selectPart.split(',').map((s) => s.trim())
      }
    }

    // Format output
    const outputRows = filtered.map((row) => {
      const out: Record<string, unknown> = {}
      for (const col of selectedCols) {
        out[col] = row[col] ?? ''
      }
      return out
    })

    const table = formatTable(selectedCols, outputRows)
    return ok(`${filtered.length} row(s) from ${path.basename(filePath)}:\n\n${table}`)
  } catch (e) {
    return err(`CSV query error: ${(e as Error).message}`)
  }
}

/** Parse a single CSV line, handling quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }

  result.push(current.trim())
  return result
}

/** Apply a simple WHERE condition to rows */
function applyWhere(rows: Record<string, string>[], condition: string): Record<string, string>[] {
  // Support: col = val, col > val, col < val, col >= val, col <= val, col != val
  // Support AND/OR (basic)

  // Split on AND (simple approach — no nested logic)
  const andParts = condition.split(/\s+AND\s+/i)

  return rows.filter((row) => {
    return andParts.every((part) => {
      return evaluateCondition(row, part.trim())
    })
  })
}

function evaluateCondition(row: Record<string, string>, condition: string): boolean {
  // Match: column operator value
  const match = condition.match(/^(\w+)\s*(>=|<=|!=|<>|=|>|<|LIKE)\s*['"]?([^'"]*?)['"]?\s*$/i)
  if (!match) return true // can't parse, include row

  const [, col, op, rawVal] = match
  const rowVal = row[col] ?? ''
  const numRow = parseFloat(rowVal)
  const numVal = parseFloat(rawVal)
  const useNum = !isNaN(numRow) && !isNaN(numVal)

  switch (op.toUpperCase()) {
    case '=':
      return useNum ? numRow === numVal : rowVal === rawVal
    case '!=':
    case '<>':
      return useNum ? numRow !== numVal : rowVal !== rawVal
    case '>':
      return useNum ? numRow > numVal : rowVal > rawVal
    case '<':
      return useNum ? numRow < numVal : rowVal < rawVal
    case '>=':
      return useNum ? numRow >= numVal : rowVal >= rawVal
    case '<=':
      return useNum ? numRow <= numVal : rowVal <= rawVal
    case 'LIKE': {
      const pattern = rawVal.replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(rowVal)
    }
    default:
      return true
  }
}

// ── Category export ──────────────────────────────────────────────────────────

export const databaseTools: ToolCategory = {
  name: 'database',
  description: 'Database tools — query SQLite databases, inspect schemas, query CSV files',
  tools: [
    {
      definition: {
        name: 'query_sqlite',
        description:
          'Execute a SQL query on a SQLite database file. Returns results as a formatted table. Supports parameterized queries.',
        category: 'database',
        input_schema: {
          type: 'object',
          properties: {
            database: { type: 'string', description: 'Path to the SQLite database file' },
            query: { type: 'string', description: 'SQL query to execute' },
            params: {
              type: 'array',
              description: 'Optional query parameters for parameterized queries',
              items: {},
            },
          },
          required: ['database', 'query'],
        },
      },
      handler: querySqliteHandler,
    },
    {
      definition: {
        name: 'list_tables',
        description:
          'List all tables and views in a database with row counts. Supports SQLite (postgres requires pg module).',
        category: 'database',
        input_schema: {
          type: 'object',
          properties: {
            database: {
              type: 'string',
              description: 'Path to SQLite file or connection string',
            },
            type: {
              type: 'string',
              enum: ['sqlite', 'postgres'],
              description: 'Database type (default "sqlite")',
            },
          },
          required: ['database'],
        },
      },
      handler: listTablesHandler,
    },
    {
      definition: {
        name: 'describe_table',
        description:
          'Show the schema of a database table including columns, types, constraints, indexes, and foreign keys.',
        category: 'database',
        input_schema: {
          type: 'object',
          properties: {
            database: {
              type: 'string',
              description: 'Path to SQLite file or connection string',
            },
            table: { type: 'string', description: 'Name of the table to describe' },
            type: {
              type: 'string',
              enum: ['sqlite', 'postgres'],
              description: 'Database type (default "sqlite")',
            },
          },
          required: ['database', 'table'],
        },
      },
      handler: describeTableHandler,
    },
    {
      definition: {
        name: 'query_csv',
        description:
          'Query a CSV file using SQL-like syntax. Supports SELECT, WHERE (=, >, <, !=, LIKE), ORDER BY, and LIMIT.',
        category: 'database',
        input_schema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Path to the CSV file' },
            query: {
              type: 'string',
              description:
                'SQL-like query (e.g. "SELECT name, age WHERE age > 25 ORDER BY age DESC LIMIT 10")',
            },
          },
          required: ['file'],
        },
      },
      handler: queryCsvHandler,
    },
  ],
}

export default databaseTools
