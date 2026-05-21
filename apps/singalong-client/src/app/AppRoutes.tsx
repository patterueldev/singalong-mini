import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

type AppRoutesProps = {
  rootElement: ReactNode
  adminElement: ReactNode
  adminLoginElement: ReactNode
  guestElement: ReactNode
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
  guestElement,
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
        <Route path="/guest" element={guestElement} />
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
