import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SongDuplicateGroup, SongDuplicateGroupMember, StoredAuth } from '../../../shared/types/client'
import { useAdminService } from '../hooks/useAdminService'
import { SkeletonList } from '../../songbook/components/SkeletonList'

type AdminDuplicateAuditPageProps = {
  auth: StoredAuth
}

const TIER_LABEL: Record<SongDuplicateGroup['tier'], string> = {
  exact: 'Exact match',
  high: 'High confidence',
  possible: 'Possible match',
}

const TIER_BADGE_CLASS: Record<SongDuplicateGroup['tier'], string> = {
  exact: 'critical',
  high: 'warning',
  possible: 'notice',
}

function memberById(members: SongDuplicateGroupMember[], songId: string): SongDuplicateGroupMember | undefined {
  return members.find((member) => member.song_id === songId)
}

function formatAddedAt(value: string | null): string {
  if (value === null) {
    return 'Unknown'
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleDateString()
}

export function AdminDuplicateAuditPage({ auth }: AdminDuplicateAuditPageProps) {
  const navigate = useNavigate()
  const { fetchDuplicateAudit, dismissDuplicatePair, mergeDuplicatePair } = useAdminService()
  const [groups, setGroups] = useState<SongDuplicateGroup[]>([])
  const [totalScanned, setTotalScanned] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [busyPairKey, setBusyPairKey] = useState<string | null>(null)

  const loadAudit = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const response = await fetchDuplicateAudit(auth.accessToken)
      setGroups(response.groups)
      setTotalScanned(response.total_songs_scanned)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load duplicate audit')
    } finally {
      setIsLoading(false)
    }
  }, [auth.accessToken, fetchDuplicateAudit])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  const handleDismiss = useCallback(
    async (songIdA: string, songIdB: string) => {
      const pairKey = `dismiss:${songIdA}:${songIdB}`
      setBusyPairKey(pairKey)
      setErrorMessage('')
      try {
        const payload = await dismissDuplicatePair(songIdA, songIdB, auth.accessToken)
        setMessage(payload.message)
        await loadAudit()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to dismiss pairing')
      } finally {
        setBusyPairKey(null)
      }
    },
    [auth.accessToken, dismissDuplicatePair, loadAudit],
  )

  const handleMerge = useCallback(
    async (keepMember: SongDuplicateGroupMember, removeMember: SongDuplicateGroupMember) => {
      if (!window.confirm(`Keep "${keepMember.title}" and archive "${removeMember.title}"?`)) {
        return
      }

      const pairKey = `merge:${keepMember.song_id}:${removeMember.song_id}`
      setBusyPairKey(pairKey)
      setErrorMessage('')
      try {
        const payload = await mergeDuplicatePair(keepMember.song_id, removeMember.song_id, auth.accessToken)
        setMessage(`${payload.message} (${payload.repointed_queue_rows} queue row(s) moved)`)
        await loadAudit()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to merge songs')
      } finally {
        setBusyPairKey(null)
      }
    },
    [auth.accessToken, loadAudit, mergeDuplicatePair],
  )

  return (
    <main className="app-shell admin-songbook-shell">
      <section className="card admin-songbook-card">
        <div className="card-header admin-songbook-header">
          <div className="admin-songbook-title-row">
            <button
              type="button"
              className="icon-control-button"
              onClick={() => navigate('/admin/songbook')}
              title="Back to songbook"
              aria-label="Back to songbook"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <h1>Duplicate Audit</h1>
          </div>
        </div>

        <div className="metrics">
          <div>
            <span className="metric-label">Songs scanned</span>
            <strong>{totalScanned}</strong>
          </div>
          <div>
            <span className="metric-label">Duplicate groups</span>
            <strong>{groups.length}</strong>
          </div>
        </div>

        {message !== '' ? <p className="success-message">{message}</p> : null}
        {errorMessage !== '' ? (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="top-gap">
          {isLoading ? (
            <SkeletonList count={3} />
          ) : groups.length === 0 ? (
            <p className="empty-state">No probable duplicates found.</p>
          ) : (
            groups.map((group) => (
              <article className="card top-gap" key={group.group_id}>
                <div className="row-actions">
                  <span className={`badge admin-songbook-status-badge ${TIER_BADGE_CLASS[group.tier]}`}>
                    {TIER_LABEL[group.tier]}
                  </span>
                </div>

                <div className="duplicate-match-list top-gap">
                  {group.edges.map((edge) => {
                    const memberA = memberById(group.members, edge.song_id_a)
                    const memberB = memberById(group.members, edge.song_id_b)
                    if (memberA === undefined || memberB === undefined) {
                      return null
                    }

                    const dismissBusy = busyPairKey === `dismiss:${memberA.song_id}:${memberB.song_id}`
                    const mergeAWinsBusy = busyPairKey === `merge:${memberA.song_id}:${memberB.song_id}`
                    const mergeBWinsBusy = busyPairKey === `merge:${memberB.song_id}:${memberA.song_id}`
                    const anyBusy = dismissBusy || mergeAWinsBusy || mergeBWinsBusy

                    return (
                      <div className="duplicate-audit-pair" key={`${edge.song_id_a}:${edge.song_id_b}`}>
                        <div className="duplicate-audit-pair-members">
                          {[memberA, memberB].map((member) => (
                            <div className="duplicate-match-row" key={member.song_id}>
                              {member.thumbnail_url ? (
                                <img className="songbook-thumbnail" src={member.thumbnail_url} alt={member.title} />
                              ) : (
                                <div className="songbook-thumbnail songbook-thumbnail--placeholder" />
                              )}
                              <div className="songbook-info">
                                <strong>{member.title}</strong>
                                <p className="session-meta">{member.artist}</p>
                                <p className="duplicate-match-status">
                                  {member.is_archived ? 'Archived' : member.status}
                                  {' · Added '}
                                  {formatAddedAt(member.added_at)}
                                </p>
                                {member.source_id !== null ? (
                                  <p className="session-meta">
                                    Source ID: <code>{member.source_id}</code>
                                  </p>
                                ) : null}
                                {member.source_url !== null ? (
                                  <p className="field-help">
                                    <a href={member.source_url} target="_blank" rel="noreferrer">
                                      {member.source_url}
                                    </a>
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>

                        <p className="field-help">
                          {edge.confidence} match · title {Math.round(edge.title_score * 100)}%
                          {edge.artist_score !== null ? ` · artist ${Math.round(edge.artist_score * 100)}%` : ''}
                        </p>

                        <div className="row-actions">
                          <button
                            type="button"
                            disabled={anyBusy}
                            onClick={() => void handleMerge(memberA, memberB)}
                          >
                            Keep "{memberA.title}"
                          </button>
                          <button
                            type="button"
                            disabled={anyBusy}
                            onClick={() => void handleMerge(memberB, memberA)}
                          >
                            Keep "{memberB.title}"
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={anyBusy}
                            onClick={() => void handleDismiss(memberA.song_id, memberB.song_id)}
                          >
                            Not a duplicate
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  )
}
