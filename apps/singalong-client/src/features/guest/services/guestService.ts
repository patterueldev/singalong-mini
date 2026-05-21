import { apiJson } from '../../../shared/api/httpClient'
import type { GuestAuth, GuestLoginResponse, SongDownloadRetryResponse } from '../../../shared/types/client'

export interface GuestService {
  buildGuestJoinUrl: (baseUrl: string, sessionCode: string | null) => string
  loginWithNickname: (nickname: string) => Promise<GuestAuth>
  reserveSong: (sessionCode: string, songId: string, token: string) => Promise<void>
  retryDownload: (songId: string) => Promise<SongDownloadRetryResponse>
}

export function buildGuestJoinUrl(baseUrl: string, sessionCode: string | null): string {
  if (sessionCode === null || sessionCode === '') {
    return ''
  }
  const normalizedBase = baseUrl.replace(/\/$/, '')
  return `${normalizedBase}/client/guest/join?sessionCode=${encodeURIComponent(sessionCode)}`
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

export async function reserveSong(sessionCode: string, songId: string, token: string): Promise<void> {
  await apiJson(
    `/sessions/${sessionCode}/queue`,
    {
      method: 'POST',
      body: JSON.stringify({ song_id: songId }),
    },
    token,
  )
}

export function retryDownload(songId: string): Promise<SongDownloadRetryResponse> {
  return apiJson<SongDownloadRetryResponse>(`/songs/downloads/${songId}/retry`, {
    method: 'POST',
  })
}

export const guestService: GuestService = {
  buildGuestJoinUrl,
  loginWithNickname,
  reserveSong,
  retryDownload,
}

export const guestLoginWithNickname = loginWithNickname
export const guestReserveSong = reserveSong
export const retrySongDownload = retryDownload
export const guestRetrySongDownload = retryDownload
