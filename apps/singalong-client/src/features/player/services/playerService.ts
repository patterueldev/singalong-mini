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
  const endpoints = [`${API_ROOT.replace(/\/$/, '')}/player-token`, `${API_ROOT}/users/player-token`]
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint)
    if (!response.ok) {
      continue
    }
    const payload = (await response.json()) as { access_token?: string }
    if (typeof payload.access_token === 'string' && payload.access_token !== '') {
      return payload.access_token
    }
  }
  throw new Error('Failed to obtain player token')
}

export const playerService: PlayerService = {
  isHostAllowed,
  fetchActiveSession: adminService.fetchActiveSession,
  fetchSessionQueue: adminService.fetchSessionQueue,
  fetchSongDetail: adminService.fetchSongDetail,
  loginPlayer,
}

export const isPlayerHostAllowed = isHostAllowed
