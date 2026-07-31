import { SuggestSearchPage } from './SuggestSearchPage'
import type { SuggestDraft } from '../../../shared/types/client'

type SuggestSearchRouteProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onIdentifyDraft: (draft: SuggestDraft) => void
  searchPath?: string
  updatePath?: string
  backToSongbookPath?: string
  backToSongbookLabel?: string
  showChangeNicknameAction?: boolean
  title?: string
  hideSearchLabel?: boolean
  searchInputPlaceholder?: string
  showCloseAction?: boolean
  closeActionLabel?: string
  showSignedIn?: boolean
}

export function SuggestSearchRoute({
  nickname,
  authToken,
  onCancel,
  onIdentifyDraft,
  searchPath = '/songbook/suggest/search',
  updatePath = '/songbook/suggest/update',
  backToSongbookPath = '/songbook',
  backToSongbookLabel = 'Back to Songbook',
  showChangeNicknameAction = false,
  title,
  hideSearchLabel,
  searchInputPlaceholder,
  showCloseAction,
  closeActionLabel,
  showSignedIn,
}: SuggestSearchRouteProps) {
  return (
    <SuggestSearchPage
      nickname={nickname}
      authToken={authToken}
      onCancel={onCancel}
      onChangeNickname={onCancel}
      searchPath={searchPath}
      updatePath={updatePath}
      backToSongbookPath={backToSongbookPath}
      backToSongbookLabel={backToSongbookLabel}
      showChangeNicknameAction={showChangeNicknameAction}
      title={title}
      hideSearchLabel={hideSearchLabel}
      searchInputPlaceholder={searchInputPlaceholder}
      showCloseAction={showCloseAction}
      closeActionLabel={closeActionLabel}
      showSignedIn={showSignedIn}
      onIdentifyDraft={onIdentifyDraft}
    />
  )
}
