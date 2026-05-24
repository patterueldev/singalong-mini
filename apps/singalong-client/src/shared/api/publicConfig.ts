import { apiJson } from './httpClient'

type PublicConfigResponse = {
  guest_base_url?: string
}

export async function fetchGuestBaseUrl(): Promise<string> {
  const payload = await apiJson<PublicConfigResponse>('/public-config')
  const value = payload.guest_base_url?.trim() ?? ''
  return value === '' ? window.location.origin : value.replace(/\/$/, '')
}
