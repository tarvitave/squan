/**
 * YAML frontmatter parser/serializer for .squan/ markdown files.
 *
 * File format:
 * ---
 * key: value
 * ---
 * # Markdown body
 */

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

export interface ParsedFile<T = Record<string, unknown>> {
  meta: T
  body: string
}

/**
 * Parse a markdown file with YAML frontmatter.
 * Returns { meta, body } where meta is the parsed YAML and body is the markdown.
 */
export function parseFrontmatter<T = Record<string, unknown>>(content: string): ParsedFile<T> {
  const trimmed = content.trim()
  if (!trimmed.startsWith('---')) {
    return { meta: {} as T, body: trimmed }
  }

  const endIndex = trimmed.indexOf('---', 3)
  if (endIndex === -1) {
    return { meta: {} as T, body: trimmed }
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim()
  const body = trimmed.slice(endIndex + 3).trim()

  try {
    const meta = yamlParse(yamlBlock) as T
    return { meta: meta ?? ({} as T), body }
  } catch {
    return { meta: {} as T, body: trimmed }
  }
}

/**
 * Serialize a meta object + markdown body into a frontmatter file.
 */
export function serializeFrontmatter<T = Record<string, unknown>>(meta: T, body: string): string {
  const yaml = yamlStringify(meta, { lineWidth: 120 }).trim()
  return `---\n${yaml}\n---\n\n${body.trim()}\n`
}
