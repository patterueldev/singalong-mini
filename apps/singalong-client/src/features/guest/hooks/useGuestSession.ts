import { useCallback, useEffect, useState } from 'react'
import { guestLoginWithNickname } from '../services/guestService'
import {
  clearGuestAuth,
  clearGuestSessionCode,
  readGuestAuth,
  readGuestSessionCode,
  saveGuestAuth,
  saveGuestSessionCode,
} from '../../../shared/storage/guestStorage'
import type { GuestAuth } from '../../../shared/types/client'

export function useGuestSession() {
  const [guestAuth, setGuestAuth] = useState<GuestAuth | null>(() => readGuestAuth())
  const [sessionCode, setSessionCode] = useState<string>(() => readGuestSessionCode())

  useEffect(() => {
    if (guestAuth === null) {
      clearGuestAuth()
      return
    }
    saveGuestAuth(guestAuth)
  }, [guestAuth])

  useEffect(() => {
    if (sessionCode === '') {
      clearGuestSessionCode()
      return
    }
    saveGuestSessionCode(sessionCode)
  }, [sessionCode])

  const joinGuestSession = useCallback(async (nickname: string, nextSessionCode: string) => {
    const payload = await guestLoginWithNickname(nickname)
    setGuestAuth(payload)
    setSessionCode(nextSessionCode)
    return payload
  }, [])

  const leaveGuestSession = useCallback(() => {
    setSessionCode('')
  }, [])

  return {
    guestAuth,
    sessionCode,
    setSessionCode,
    setGuestAuth,
    joinGuestSession,
    leaveGuestSession,
    hasGuestSession: guestAuth !== null && sessionCode !== '',
  }
}
