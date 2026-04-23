/**
 * Claude (Anthropic) OAuth — loopback PKCE flow.
 *
 * The browser is redirected to http://localhost:PORT/callback on our own
 * Express server, which captures the code and exchanges it for tokens. The
 * PKCE verifier is passed as `state` so the OAuth server can correlate the
 * redirect back to the original request.
 *
 * These endpoints/client are undocumented and may change without notice.
 */

import { createHash, randomBytes } from 'crypto'

const decode = (s: string) => Buffer.from(s, 'base64').toString('utf8')
export const CLAUDE_OAUTH_CLIENT_ID = decode('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl')
export const CLAUDE_OAUTH_AUTHORIZE = 'https://claude.ai/oauth/authorize'
export const CLAUDE_OAUTH_TOKEN = 'https://platform.claude.com/v1/oauth/token'
export const CLAUDE_OAUTH_SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
export const CLAUDE_OAUTH_BETA_HEADER = 'oauth-2025-04-20'

export interface OAuthStartResult {
  url: string
  /** The PKCE verifier — also used as the `state` parameter. */
  verifier: string
  /** What we told Anthropic the redirect URI is; must be passed unchanged at token exchange. */
  redirectUri: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO timestamp
  scope: string
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createAuthUrl(redirectUri: string): OAuthStartResult {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())

  const params = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: CLAUDE_OAUTH_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier, // pi-mono uses the verifier as state — works with Anthropic's OAuth server
  })

  return {
    url: `${CLAUDE_OAUTH_AUTHORIZE}?${params.toString()}`,
    verifier,
    redirectUri,
  }
}

export async function exchangeCodeForTokens(params: {
  code: string
  state: string
  verifier: string
  redirectUri: string
}): Promise<OAuthTokens> {
  const res = await fetch(CLAUDE_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      code: params.code,
      state: params.state,
      redirect_uri: params.redirectUri,
      code_verifier: params.verifier,
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${body}`)
  const data = JSON.parse(body) as {
    access_token: string; refresh_token: string; expires_in: number; scope?: string
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope ?? CLAUDE_OAUTH_SCOPES,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(CLAUDE_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${body}`)
  const data = JSON.parse(body) as {
    access_token: string; refresh_token?: string; expires_in: number; scope?: string
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope ?? CLAUDE_OAUTH_SCOPES,
  }
}
