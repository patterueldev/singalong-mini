import { useNavigate } from 'react-router-dom'
import { SuggestSearchPage } from './SuggestSearchPage'

type SuggestSearchRouteProps = {
  nickname: string
  authToken: string
  onCancel: () => void
  onChangeNickname: () => void
}

export function SuggestSearchRoute({
  nickname,
  authToken,
  onCancel,
  onChangeNickname,
}: SuggestSearchRouteProps) {
  const navigate = useNavigate()

  return (
    <SuggestSearchPage
      nickname={nickname}
      authToken={authToken}
      onCancel={onCancel}
      onChangeNickname={onChangeNickname}
      onIdentify={(sourceUrl) => {
        navigate(`/songbook/suggest/identify?url=${encodeURIComponent(sourceUrl)}`)
      }}
    />
  )
}
