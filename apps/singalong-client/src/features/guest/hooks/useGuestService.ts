import { useMemo } from 'react'
import { guestService } from '../services/guestService'

export function useGuestService() {
  return useMemo(() => guestService, [])
}
