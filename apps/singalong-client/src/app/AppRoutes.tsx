import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

type AppRoutesProps = {
  rootElement: ReactNode
  adminElement: ReactNode
  adminLoginElement: ReactNode
  guestJoinElement: ReactNode
  guestHomeElement: ReactNode
  guestDownloadsElement: ReactNode
  guestSongbookElement: ReactNode
  guestSuggestSearchElement: ReactNode
  guestSuggestIdentifyElement: ReactNode
  guestSuggestUpdateElement: ReactNode
  playerElement: ReactNode
  songbookElement: ReactNode
  songDetailElement: ReactNode
  suggestLoginElement: ReactNode
  suggestSearchElement: ReactNode
  suggestIdentifyElement: ReactNode
  suggestUpdateElement: ReactNode
  adminSessionsElement: ReactNode
  adminSessionControlElement: ReactNode
  adminSongbookElement: ReactNode
  adminSongbookSuggestLoginElement: ReactNode
  adminSongbookSuggestSearchElement: ReactNode
  adminSongbookSuggestIdentifyElement: ReactNode
  adminSongbookSuggestUpdateElement: ReactNode
}

export function AppRoutes({
  rootElement,
  adminElement,
  adminLoginElement,
  guestJoinElement,
  guestHomeElement,
  guestDownloadsElement,
  guestSongbookElement,
  guestSuggestSearchElement,
  guestSuggestIdentifyElement,
  guestSuggestUpdateElement,
  playerElement,
  songbookElement,
  songDetailElement,
  suggestLoginElement,
  suggestSearchElement,
  suggestIdentifyElement,
  suggestUpdateElement,
  adminSessionsElement,
  adminSessionControlElement,
  adminSongbookElement,
  adminSongbookSuggestLoginElement,
  adminSongbookSuggestSearchElement,
  adminSongbookSuggestIdentifyElement,
  adminSongbookSuggestUpdateElement,
}: AppRoutesProps) {
  return (
    <Routes>
      <Route path="/" element={rootElement} />
      <Route path="/admin" element={adminElement} />
      <Route path="/admin/login" element={adminLoginElement} />
      <Route path="/guest" element={guestJoinElement} />
      <Route path="/guest/join" element={guestJoinElement} />
      <Route path="/guest/login" element={guestJoinElement} />
      <Route path="/guest/home" element={guestHomeElement} />
      <Route path="/guest/downloads" element={guestDownloadsElement} />
      <Route path="/guest/songbook" element={guestSongbookElement} />
      <Route path="/guest/songbook/suggest/search" element={guestSuggestSearchElement} />
      <Route path="/guest/songbook/suggest/identify" element={guestSuggestIdentifyElement} />
      <Route path="/guest/songbook/suggest/update" element={guestSuggestUpdateElement} />
      <Route path="/player" element={playerElement} />
      <Route path="/songbook" element={songbookElement} />
      <Route path="/songbook/song/:id" element={songDetailElement} />
      <Route path="/songbook/suggest/login" element={suggestLoginElement} />
      <Route path="/songbook/suggest/search" element={suggestSearchElement} />
      <Route path="/songbook/suggest/identify" element={suggestIdentifyElement} />
      <Route path="/songbook/suggest/update" element={suggestUpdateElement} />
      <Route path="/admin/dashboard" element={adminSessionsElement} />
      <Route path="/admin/sessions" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/admin/songbook" element={adminSongbookElement} />
      <Route path="/admin/songbook/suggest" element={<Navigate to="/admin/songbook/suggest/search" replace />} />
      <Route path="/admin/songbook/suggest/login" element={adminSongbookSuggestLoginElement} />
      <Route path="/admin/songbook/suggest/search" element={adminSongbookSuggestSearchElement} />
      <Route path="/admin/songbook/suggest/identify" element={adminSongbookSuggestIdentifyElement} />
      <Route path="/admin/songbook/suggest/update" element={adminSongbookSuggestUpdateElement} />
      <Route path="/admin/sessions/:sessionCode" element={adminSessionControlElement} />
      <Route path="*" element={<Navigate to="/guest" replace />} />
    </Routes>
  )
}
