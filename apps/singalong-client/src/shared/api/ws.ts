import { WS_BASE } from '../config/client'

export function buildWSUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  if (query === '') {
    return `${WS_BASE}${path}`
  }
  return `${WS_BASE}${path}?${query}`
}
