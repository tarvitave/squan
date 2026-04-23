import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'

export interface WorkspaceInfo {
  root: string
  separator: string
  platform: string
  townId: string
}

let cache: WorkspaceInfo | null = null
let inflight: Promise<WorkspaceInfo> | null = null

export async function getWorkspaceInfo(force = false): Promise<WorkspaceInfo> {
  if (cache && !force) return cache
  if (inflight) return inflight
  inflight = apiFetch('/api/workspace-info')
    .then((r) => r.json())
    .then((data: WorkspaceInfo) => {
      cache = data
      inflight = null
      return data
    })
    .catch((err) => {
      inflight = null
      throw err
    })
  return inflight
}

export function invalidateWorkspaceInfo() {
  cache = null
}

export function useWorkspaceInfo(): WorkspaceInfo | null {
  const [info, setInfo] = useState<WorkspaceInfo | null>(cache)
  useEffect(() => {
    getWorkspaceInfo().then(setInfo).catch(() => {})
  }, [])
  return info
}

/** Build a clone path under the workspace root, using the platform separator. */
export function buildClonePath(info: WorkspaceInfo | null, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!info) return slug // fallback — server will resolve against default if needed
  const root = info.root.replace(/[\\/]+$/, '')
  return `${root}${info.separator}${slug}`
}

/**
 * Suggest a path for a new *town* (namespace). Towns are separate workspace
 * roots, so we place them as siblings of the default — e.g. the default
 * `~/squan-workspace` becomes a peer of `~/squan-work`, `~/squan-personal`, etc.
 * Returns an empty string if the user hasn't typed a name yet.
 */
export function buildTownPath(info: WorkspaceInfo | null, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) return ''
  if (!info) return `squan-${slug}`
  const sep = info.separator
  const normalized = info.root.replace(/[\\/]+$/, '')
  const lastSep = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  const parent = lastSep >= 0 ? normalized.slice(0, lastSep) : normalized
  return `${parent}${sep}squan-${slug}`
}
