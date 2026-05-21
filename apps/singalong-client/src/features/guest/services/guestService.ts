import { apiJson } from '../../../shared/api/httpClient'
import type { GuestAuth, GuestLoginResponse, SongDownloadRetryResponse } from '../../../shared/types/client'

export interface GuestService {
  buildGuestJoinUrl: (baseUrl: string, sessionId: string | null) => string
  loginWithNickname: (nickname: string) => Promise<GuestAuth>
  retryDownload: (songId: string) => Promise<SongDownloadRetryResponse>
}

export function buildGuestJoinUrl(baseUrl: string, sessionId: string | null): string {
  if (sessionId === null || sessionId === '') {
    return ''
  }
  const normalizedBase = baseUrl.replace(/\/$/, '')
  return `${normalizedBase}/client/guest/login?sessionId=${encodeURIComponent(sessionId)}`
}

export async function loginWithNickname(nickname: string): Promise<GuestAuth> {
  const payload = await apiJson<GuestLoginResponse>('/users/guest/login', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  })

  return {
    accessToken: payload.access_token,
    nickname: payload.nickname,
    user: payload.user,
  }
}

export function retryDownload(songId: string): Promise<SongDownloadRetryResponse> {
  return apiJson<SongDownloadRetryResponse>(`/songs/downloads/${songId}/retry`, {
    method: 'POST',
  })
}

export const guestService: GuestService = {
  buildGuestJoinUrl,
  loginWithNickname,
  retryDownload,
}

export const guestLoginWithNickname = loginWithNickname
export const retrySongDownload = retryDownload
