import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

type AppRoutesProps = {
  adminElement: ReactNode
  adminLoginElement: ReactNode
  guestJoinElement: ReactNode
  guestHomeElement: ReactNode
  guestDownloadsElement: ReactNode
  guestSongbookElement: ReactNode
  guestSuggestSearchElement: ReactNode
  guestSuggestUpdateElement: ReactNode
  playerElement: ReactNode
  songbookLoginElement: ReactNode
  songbookElement: ReactNode
  songDetailElement: ReactNode
  suggestSearchElement: ReactNode
  suggestUpdateElement: ReactNode
  adminSessionsElement: ReactNode
  adminSessionControlElement: ReactNode
  adminSongbookElement: ReactNode
  adminSongbookSuggestSearchElement: ReactNode
  adminSongbookSuggestUpdateElement: ReactNode
  adminSessionSuggestSearchElement: ReactNode
  adminSessionSuggestUpdateElement: ReactNode
}

export function AppRoutes({
  adminElement,
  adminLoginElement,
  guestJoinElement,
  guestHomeElement,
  guestDownloadsElement,
  guestSongbookElement,
  guestSuggestSearchElement,
  guestSuggestUpdateElement,
  playerElement,
  songbookLoginElement,
  songbookElement,
  songDetailElement,
  suggestSearchElement,
  suggestUpdateElement,
  adminSessionsElement,
  adminSessionControlElement,
  adminSongbookElement,
  adminSongbookSuggestSearchElement,
  adminSongbookSuggestUpdateElement,
  adminSessionSuggestSearchElement,
  adminSessionSuggestUpdateElement,
}: AppRoutesProps) {
  return (
    <Routes>
      <Route path="/" element={guestJoinElement} />
      <Route path="/join" element={guestJoinElement} />
      <Route path="/login" element={guestJoinElement} />
      <Route path="/home" element={guestHomeElement} />
      <Route path="/downloads" element={guestDownloadsElement} />
      <Route path="/songs" element={guestSongbookElement} />
      <Route path="/songs/suggest/search" element={guestSuggestSearchElement} />
      <Route path="/songs/suggest/identify" element={<Navigate to="/songs/suggest/search" replace />} />
      <Route path="/songs/suggest/update" element={guestSuggestUpdateElement} />
      <Route path="/player" element={playerElement} />
      <Route path="/admin" element={adminElement} />
      <Route path="/admin/login" element={adminLoginElement} />
      <Route path="/songbook/login" element={songbookLoginElement} />
      <Route path="/songbook" element={songbookElement} />
      <Route path="/songbook/song/:id" element={songDetailElement} />
      <Route path="/songbook/suggest/login" element={songbookLoginElement} />
      <Route path="/songbook/suggest/search" element={suggestSearchElement} />
      <Route path="/songbook/suggest/identify" element={<Navigate to="/songbook/suggest/search" replace />} />
      <Route path="/songbook/suggest/update" element={suggestUpdateElement} />
      <Route path="/admin/dashboard" element={adminSessionsElement} />
      <Route path="/admin/sessions" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/admin/songbook" element={adminSongbookElement} />
      <Route path="/admin/songbook/suggest" element={<Navigate to="/admin/songbook/suggest/search" replace />} />
      <Route path="/admin/songbook/suggest/login" element={<Navigate to="/admin/songbook/suggest/search" replace />} />
      <Route path="/admin/songbook/suggest/search" element={adminSongbookSuggestSearchElement} />
      <Route path="/admin/songbook/suggest/identify" element={<Navigate to="/admin/songbook/suggest/search" replace />} />
      <Route path="/admin/songbook/suggest/update" element={adminSongbookSuggestUpdateElement} />
      <Route path="/admin/sessions/:sessionCode" element={adminSessionControlElement} />
      <Route path="/admin/sessions/:sessionCode/songbook/suggest/search" element={adminSessionSuggestSearchElement} />
      <Route path="/admin/sessions/:sessionCode/songbook/suggest/update" element={adminSessionSuggestUpdateElement} />
      <Route path="/admin/sessions/:sessionCode/songbook/suggest/identify" element={adminSessionSuggestSearchElement} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
