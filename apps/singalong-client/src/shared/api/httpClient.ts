import { API_ROOT } from '../config/client'

let _onAuthFailure: (() => void) | null = null

export function setOnAuthFailure(callback: (() => void) | null) {
  _onAuthFailure = callback
}

export class ApiError extends Error {
  status: number
  timedOut: boolean

  constructor(message: string, status: number, timedOut = false) {
    super(message)
    this.status = status
    this.timedOut = timedOut
  }
}

function authHeaders(token?: string): HeadersInit {
  if (token === undefined) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  timeoutMs?: number,
): Promise<T> {
  const headers = new Headers(init.headers ?? {})
  if (token !== undefined) {
    const bearerHeaders = authHeaders(token)
    Object.entries(bearerHeaders).forEach(([key, value]) => {
      headers.set(key, value)
    })
  }

  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const controller = timeoutMs !== undefined ? new AbortController() : null
  const timeoutId = controller !== null ? setTimeout(() => controller.abort(), timeoutMs) : null

  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers,
      signal: controller?.signal ?? init.signal,
    })
  } catch (error) {
    if (controller !== null && controller.signal.aborted) {
      throw new ApiError('Request timed out', 0, true)
    }
    throw error
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    const error = new ApiError(payload?.detail ?? 'Request failed', response.status)
    if (error.status === 401 && _onAuthFailure) {
      _onAuthFailure()
    }
    throw error
  }

  return response.json() as Promise<T>
}
