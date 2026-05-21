import { useMemo } from 'react'
import { suggestService } from '../services/suggestService'

export function useSuggestService() {
  return useMemo(() => suggestService, [])
}
