import { LANGUAGE_OPTIONS } from '../config/client'
import type { DownloadProgressItem, LanguageCode } from '../types/client'

export function normalizeLanguageCodeForUi(language: string | null | undefined): LanguageCode | '' {
  if (typeof language !== 'string' || language.trim() === '') {
    return ''
  }
  const normalized = language.trim().toLowerCase()
  return LANGUAGE_OPTIONS.some((option) => option.code === (normalized as LanguageCode))
    ? (normalized as LanguageCode)
    : 'other'
}

export function formatLanguageLabel(language: string | null | undefined): string {
  const normalized = normalizeLanguageCodeForUi(language)
  if (normalized === '') {
    return '—'
  }
  return LANGUAGE_OPTIONS.find((option) => option.code === normalized)?.label ?? 'Others'
}

export function formatDurationClock(valueSeconds: number | null | undefined): string {
  if (typeof valueSeconds !== 'number' || !Number.isFinite(valueSeconds) || valueSeconds < 0) {
    return '--:--'
  }
  const total = Math.floor(valueSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatTimeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '00:00'
  }
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function parseTimeMs(timeStr: string): number {
  const parts = timeStr.split(':')
  if (parts.length !== 2) {
    return 0
  }
  const [minutesStr, secondsStr] = parts
  const minutes = parseInt(minutesStr, 10)
  const seconds = parseInt(secondsStr, 10)
  if (isNaN(minutes) || isNaN(seconds)) {
    return 0
  }
  return (minutes * 60 + seconds) * 1000
}

export function calculateDuration(startMs: number, endMs: number): number {
  if (endMs <= startMs) {
    return 0
  }
  return endMs - startMs
}

export function getTimerDurationDisplay(startMs: number, endMs: number): string {
  return `${formatTimeMs(endMs - startMs)}`
}

export function formatDownloadStatus(status: DownloadProgressItem['status']): string {
  if (status === 'pending') {
    return 'Pending'
  }
  if (status === 'downloading') {
    return 'Downloading'
  }
  if (status === 'cancelled') {
    return 'Cancelled'
  }
  return 'Error'
}
