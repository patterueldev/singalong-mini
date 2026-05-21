import { PLAYER_PASSWORD, PLAYER_USERNAME } from '../../../shared/config/client'
import { adminService } from '../../admin/services/adminService'
import { authService } from '../../shared/services/authService'

export interface PlayerService {
  isHostAllowed: (hostname: string) => boolean
  fetchActiveSession: typeof adminService.fetchActiveSession
  fetchSessionQueue: typeof adminService.fetchSessionQueue
  fetchSongDetail: typeof adminService.fetchSongDetail
  loginPlayer: () => Promise<string>
}

export function isHostAllowed(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true
  }
  return normalized.endsWith('.local')
}

export async function loginPlayer(): Promise<string> {
  const payload = await authService.login(PLAYER_USERNAME, PLAYER_PASSWORD)
  return payload.access_token
}

export const playerService: PlayerService = {
  isHostAllowed,
  fetchActiveSession: adminService.fetchActiveSession,
  fetchSessionQueue: adminService.fetchSessionQueue,
  fetchSongDetail: adminService.fetchSongDetail,
  loginPlayer,
}

export const isPlayerHostAllowed = isHostAllowed
