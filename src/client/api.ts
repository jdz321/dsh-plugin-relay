/**
 * Thin same-origin fetch wrappers for the host plugin's /api/relay/* routes.
 */

export class ApiError extends Error {
  readonly payload: Record<string, unknown>

  constructor(message: string, payload: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.payload = payload
  }
}

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!res.ok) throw new ApiError((body.error as string) || `HTTP ${res.status}`, body)
  return body
}

export function apiGet(path: string): Promise<Record<string, unknown>> {
  return call(path, { headers: { accept: 'application/json' } })
}

export function apiPost(path: string, payload: unknown): Promise<Record<string, unknown>> {
  return call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
}
