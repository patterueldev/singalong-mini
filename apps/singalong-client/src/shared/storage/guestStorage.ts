import { GUEST_AUTH_STORAGE_KEY, GUEST_SESSION_CODE_STORAGE_KEY } from '../config/client'
import type { GuestAuth, UserProfile } from '../types/client'
import { isValidSessionCode } from '../lib/validation'

export function readGuestAuth(): GuestAuth | null {
  const raw = window.localStorage.getItem(GUEST_AUTH_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GuestAuth>
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken !== '' &&
      typeof parsed.nickname === 'string' &&
      parsed.nickname !== '' &&
      typeof parsed.user?.id === 'string'
    ) {
      return {
        accessToken: parsed.accessToken,
        nickname: parsed.nickname,
        user: parsed.user as UserProfile,
      }
    }
  } catch {
    // Fall through to clear invalid payloads.
  }

  window.localStorage.removeItem(GUEST_AUTH_STORAGE_KEY)
  return null
}

export function saveGuestAuth(auth: GuestAuth) {
  window.localStorage.setItem(GUEST_AUTH_STORAGE_KEY, JSON.stringify(auth))
}

export function clearGuestAuth() {
  window.localStorage.removeItem(GUEST_AUTH_STORAGE_KEY)
}

export function readGuestSessionCode(): string {
  const value = window.localStorage.getItem(GUEST_SESSION_CODE_STORAGE_KEY) ?? ''
  return isValidSessionCode(value) ? value : ''
}

export function saveGuestSessionCode(sessionCode: string) {
  window.localStorage.setItem(GUEST_SESSION_CODE_STORAGE_KEY, sessionCode)
}

export function clearGuestSessionCode() {
  window.localStorage.removeItem(GUEST_SESSION_CODE_STORAGE_KEY)
}
