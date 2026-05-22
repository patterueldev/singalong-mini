import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

type AppRoutesProps = {
  rootElement: ReactNode
  adminElement: ReactNode
  adminLoginElement: ReactNode
  guestJoinElement: ReactNode
  guestHomeElement: ReactNode
  guestDownloadsElement: ReactNode
  guestSongbookElement: ReactNode
  playerElement: ReactNode
  songbookElement: ReactNode
  songDetailElement: ReactNode
  suggestLoginElement: ReactNode
  suggestSearchElement: ReactNode
  suggestIdentifyElement: ReactNode
  suggestUpdateElement: ReactNode
  adminSessionsElement: ReactNode
  adminSessionControlElement: ReactNode
}

export function AppRoutes({
  rootElement,
  adminElement,
  adminLoginElement,
  guestJoinElement,
  guestHomeElement,
  guestDownloadsElement,
  guestSongbookElement,
  playerElement,
  songbookElement,
  songDetailElement,
  suggestLoginElement,
  suggestSearchElement,
  suggestIdentifyElement,
  suggestUpdateElement,
  adminSessionsElement,
  adminSessionControlElement,
}: AppRoutesProps) {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
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
        <Route path="/player" element={playerElement} />
        <Route path="/songbook" element={songbookElement} />
        <Route path="/songbook/song/:id" element={songDetailElement} />
        <Route path="/songbook/suggest/login" element={suggestLoginElement} />
        <Route path="/songbook/suggest/search" element={suggestSearchElement} />
        <Route path="/songbook/suggest/identify" element={suggestIdentifyElement} />
        <Route path="/songbook/suggest/update" element={suggestUpdateElement} />
        <Route path="/admin/sessions" element={adminSessionsElement} />
        <Route path="/admin/sessions/:sessionCode" element={adminSessionControlElement} />
        <Route path="*" element={<Navigate to="/guest" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
