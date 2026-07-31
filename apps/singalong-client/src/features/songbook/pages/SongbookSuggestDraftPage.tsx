import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { SongbookSuggestUpdatePage } from './SongbookSuggestUpdatePage'
import type { SuggestDraft } from '../../../shared/types/client'
import {
  clearSuggestDraft,
  readSuggestDraft,
  saveSuggestDraft,
} from '../../../shared/storage/suggestStorage'

type SongbookSuggestDraftPageProps = {
  authToken: string
  onDownloaded: (title: string) => void
}

export function SongbookSuggestDraftPage({ authToken, onDownloaded }: SongbookSuggestDraftPageProps) {
  const [draft, setDraft] = useState<SuggestDraft | null>(() => readSuggestDraft())

  useEffect(() => {
    if (draft !== null) {
      saveSuggestDraft(draft)
    }
  }, [draft])

  if (draft === null) {
    return <Navigate to="/songbook" replace />
  }

  return (
    <SongbookSuggestUpdatePage
      authToken={authToken}
      draft={draft}
      onDraftChange={setDraft}
      onDiscardDraft={clearSuggestDraft}
      onDownloaded={onDownloaded}
    />
  )
}
