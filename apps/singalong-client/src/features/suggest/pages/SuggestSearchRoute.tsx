import { useNavigate } from 'react-router-dom'
import { SuggestSearchPage } from './SuggestSearchPage'

type SuggestSearchRouteProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onChangeNickname: () => void
  identifyPath?: string
  searchPath?: string
  backToSongbookPath?: string
  backToSongbookLabel?: string
  showChangeNicknameAction?: boolean
}

export function SuggestSearchRoute({
  nickname,
  authToken,
  onCancel,
  onChangeNickname,
  identifyPath = '/songbook/suggest/identify',
  searchPath = '/songbook/suggest/search',
  backToSongbookPath = '/songbook',
  backToSongbookLabel = 'Back to Songbook',
  showChangeNicknameAction = true,
}: SuggestSearchRouteProps) {
  const navigate = useNavigate()

  return (
    <SuggestSearchPage
      nickname={nickname}
      authToken={authToken}
      onCancel={onCancel}
      onChangeNickname={onChangeNickname}
      searchPath={searchPath}
      identifyPath={identifyPath}
      backToSongbookPath={backToSongbookPath}
      backToSongbookLabel={backToSongbookLabel}
      showChangeNicknameAction={showChangeNicknameAction}
      onIdentify={(sourceUrl) => {
        navigate(`${identifyPath}?url=${encodeURIComponent(sourceUrl)}`)
      }}
    />
  )
}
