import { useMemo } from 'react'
import { adminService } from '../services/adminService'

export function useAdminService() {
  return useMemo(() => adminService, [])
}
