import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { GuestSuggestUpdatePage } from './GuestSuggestUpdatePage'
import type { SuggestDraft } from '../../../shared/types/client'
import {
  clearSuggestDraft,
  readSuggestDraft,
  saveSuggestDraft,
} from '../../../shared/storage/suggestStorage'

export function GuestSuggestDraftPage() {
  const [draft, setDraft] = useState<SuggestDraft | null>(() => readSuggestDraft())

  useEffect(() => {
    if (draft !== null) {
      saveSuggestDraft(draft)
    }
  }, [draft])

  if (draft === null) {
    return <Navigate to="/songs" replace />
  }

  return (
    <GuestSuggestUpdatePage
      draft={draft}
      onDraftChange={setDraft}
      onDiscardDraft={clearSuggestDraft}
    />
  )
}
