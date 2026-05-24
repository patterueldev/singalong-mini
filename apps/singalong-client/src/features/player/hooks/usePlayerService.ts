import { useMemo } from 'react'
import { playerService } from '../services/playerService'

export function usePlayerService() {
  return useMemo(() => playerService, [])
}
