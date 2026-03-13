import { useStore } from '../store/index.js'

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = useStore.getState().token
  return fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
}
