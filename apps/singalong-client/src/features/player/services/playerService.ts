import { API_ROOT } from '../../../shared/config/client'
import { adminService } from '../../admin/services/adminService'

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
  const response = await fetch(`${API_ROOT}/users/player-token`)
  if (!response.ok) {
    throw new Error(`Failed to obtain player token: ${response.status}`)
  }
  const data = (await response.json()) as { access_token: string }
  return data.access_token
}

export const playerService: PlayerService = {
  isHostAllowed,
  fetchActiveSession: adminService.fetchActiveSession,
  fetchSessionQueue: adminService.fetchSessionQueue,
  fetchSongDetail: adminService.fetchSongDetail,
  loginPlayer,
}

export const isPlayerHostAllowed = isHostAllowed
