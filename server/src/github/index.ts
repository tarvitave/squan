import { execFileSync } from 'child_process'

export function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  const cleaned = repoUrl.trim()
  const ssh = cleaned.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
  if (ssh) return { owner: ssh[1], repo: ssh[2] }
  const https = cleaned.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/)
  if (https) return { owner: https[1], repo: https[2] }
  return null
}

export function detectDefaultBranch(localPath: string): string {
  try {
    const out = execFileSync('git', ['-C', localPath, 'symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], { stdio: 'pipe' }).toString().trim()
    return out.replace(/^origin\//, '')
  } catch {
    return 'main'
  }
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<{ url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, head, base }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(err.message ?? `GitHub API ${res.status}`)
  }
  const data = await res.json() as { html_url: string; number: number }
  return { url: data.html_url, number: data.number }
}

export async function getPullRequestStatus(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ state: string; merged: boolean }> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const data = await res.json() as { state: string; merged: boolean }
  return { state: data.state, merged: data.merged }
}
