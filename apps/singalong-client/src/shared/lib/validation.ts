import { NICKNAME_REGEX } from '../config/client'

export const SESSION_CODE_REGEX = /^\d{6}$/

export function isValidNickname(value: string): boolean {
  return NICKNAME_REGEX.test(value)
}

export function isValidSessionCode(value: string): boolean {
  return SESSION_CODE_REGEX.test(value)
}
