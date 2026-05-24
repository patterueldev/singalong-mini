import { apiJson } from '../../../shared/api/httpClient'
import type { LoginResponse } from '../../../shared/types/client'

export interface AuthService {
  login: (username: string, password: string) => Promise<LoginResponse>
  logout: (username: string, token: string) => Promise<void>
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiJson<LoginResponse>('/users/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function logout(username: string, token: string): Promise<void> {
  await apiJson<{ message: string }>(
    '/users/logout',
    {
      method: 'POST',
      body: JSON.stringify({ username }),
    },
    token,
  )
}

export const authService: AuthService = {
  login,
  logout,
}

export const loginUser = login
export const logoutUser = logout
