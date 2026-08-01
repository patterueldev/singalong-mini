import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const DEFAULT_TITLE = 'Singalong'

function titleForPath(pathname: string): string {
  if (pathname.startsWith('/admin')) {
    return 'Singalong Admin'
  }
  if (pathname.startsWith('/songbook')) {
    return 'Singalong Songbook'
  }
  return DEFAULT_TITLE
}

export function useDocumentTitle() {
  const location = useLocation()

  useEffect(() => {
    document.title = titleForPath(location.pathname)
  }, [location.pathname])
}
