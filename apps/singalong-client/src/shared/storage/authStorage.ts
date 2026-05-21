import { AUTH_STORAGE_KEY } from '../config/client'
import type { StoredAuth, UserProfile } from '../types/client'

export function readStoredAuth(): StoredAuth | null {
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuth>
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken !== '' &&
      typeof parsed.user?.username === 'string'
    ) {
      return {
        accessToken: parsed.accessToken,
        user: parsed.user as UserProfile,
      }
    }
  } catch {
    // Fall through to clear invalid payloads.
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY)
  return null
}

export function saveStoredAuth(auth: StoredAuth) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
}

export function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY)
}
