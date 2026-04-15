/**
 * Web browsing tools for agents — fetch URLs and convert HTML to text.
 */

import { execSync } from 'child_process'

/** Fetch a URL and return its content as plain text */
export async function fetchUrl(url: string, maxLength = 50000): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Squan-Agent/0.4.0 (https://squan.dev)',
        'Accept': 'text/html,application/json,text/plain,*/*',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      return `Error: HTTP ${response.status} ${response.statusText}`
    }

    const contentType = response.headers.get('content-type') ?? ''

    // JSON — return as-is
    if (contentType.includes('json')) {
      const text = await response.text()
      return text.slice(0, maxLength)
    }

    // Plain text
    if (contentType.includes('text/plain')) {
      const text = await response.text()
      return text.slice(0, maxLength)
    }

    // HTML — strip tags for readability
    const html = await response.text()
    return htmlToText(html).slice(0, maxLength)
  } catch (err) {
    return `Error fetching ${url}: ${(err as Error).message}`
  }
}

/** Convert HTML to readable plain text */
function htmlToText(html: string): string {
  let text = html

  // Remove scripts and styles
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

/** Simple web search using DuckDuckGo instant answer API */
export async function searchWeb(query: string, maxResults = 5): Promise<string> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Squan-Agent/0.4.0' },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return `Search failed: HTTP ${response.status}`

    const data = await response.json() as any
    const results: string[] = []

    // Abstract
    if (data.Abstract) {
      results.push(`## ${data.Heading || query}`)
      results.push(data.Abstract)
      if (data.AbstractURL) results.push(`Source: ${data.AbstractURL}`)
      results.push('')
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, maxResults)) {
        if (topic.Text) {
          results.push(`• ${topic.Text}`)
          if (topic.FirstURL) results.push(`  ${topic.FirstURL}`)
        }
      }
    }

    // Answer
    if (data.Answer) {
      results.push(`Answer: ${data.Answer}`)
    }

    return results.length > 0 ? results.join('\n') : `No results found for: ${query}`
  } catch (err) {
    return `Search error: ${(err as Error).message}`
  }
}
