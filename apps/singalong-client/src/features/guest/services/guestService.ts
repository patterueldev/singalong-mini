import { apiJson } from '../../../shared/api/httpClient'
import type {
  GuestAuth,
  GuestLoginResponse,
  SessionExistsResponse,
  SongDownloadRetryResponse,
} from '../../../shared/types/client'

export interface GuestService {
  buildGuestJoinUrl: (baseUrl: string, sessionCode: string | null) => string
  fetchSessionInfo: (sessionCode: string) => Promise<SessionExistsResponse>
  checkSessionExists: (sessionCode: string) => Promise<boolean>
  loginWithNickname: (nickname: string) => Promise<GuestAuth>
  reserveSong: (sessionCode: string, songId: string, token: string) => Promise<void>
  cancelQueueItem: (sessionCode: string, queueId: string, token: string) => Promise<void>
  skipQueueItem: (sessionCode: string, queueId: string, token: string) => Promise<void>
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

export async function checkSessionExists(sessionCode: string): Promise<boolean> {
  const payload = await fetchSessionInfo(sessionCode)
  return payload.exists === true
}

export function fetchSessionInfo(sessionCode: string): Promise<SessionExistsResponse> {
  return apiJson<SessionExistsResponse>(`/sessions/${sessionCode}/exists`)
}

export async function cancelQueueItem(sessionCode: string, queueId: string, token: string): Promise<void> {
  await apiJson(`/sessions/${sessionCode}/queue/${queueId}`, { method: 'DELETE' }, token)
}

export async function skipQueueItem(sessionCode: string, queueId: string, token: string): Promise<void> {
  await apiJson(
    `/sessions/${sessionCode}/queue/${queueId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ action: 'skip' }),
    },
    token,
  )
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
  fetchSessionInfo,
  checkSessionExists,
  loginWithNickname,
  reserveSong,
  cancelQueueItem,
  skipQueueItem,
  retryDownload,
}

export const guestLoginWithNickname = loginWithNickname
export const guestCheckSessionExists = checkSessionExists
export const guestFetchSessionInfo = fetchSessionInfo
export const guestReserveSong = reserveSong
export const guestCancelQueueItem = cancelQueueItem
export const guestSkipQueueItem = skipQueueItem
export const retrySongDownload = retryDownload
export const guestRetrySongDownload = retryDownload
