import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LegislatorDetail, LoadState } from '../types'
import { formatDate } from '../lib/format'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './LegislatorDetailPage.module.css'

function partyColor(party: string | null): string {
  if (party === 'D') return 'var(--teal)'
  if (party === 'R') return 'var(--accent, #b9723d)'
  return 'var(--muted)'
}

export function LegislatorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<LoadState<LegislatorDetail>>({ status: 'loading' })

  useEffect(() => {
    if (!id) return
    setDetail({ status: 'loading' })
    client
      .getLegislatorDetail(id)
      .then((data) => setDetail({ status: 'ready', data }))
      .catch(() => setDetail({ status: 'empty' }))
  }, [id])

  if (detail.status === 'loading') {
    return <div className={styles.page}>Loading legislator…</div>
  }
  if (detail.status === 'empty') {
    return (
      <div className={styles.page}>
        <button className={styles.backLink} onClick={() => navigate(-1)}>
          ← Back
        </button>
        <EmptyState message="This legislator couldn't be found." />
      </div>
    )
  }

  const l = detail.data

  return (
    <div className={styles.page}>
      <button className={styles.backLink} onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className={styles.header}>
        <h1 className={styles.name}>{l.name}</h1>
        <p className={styles.meta}>
          <span style={{ textTransform: 'capitalize' }}>{l.chamber ?? 'Chamber unknown'}</span>
          {' · '}
          <span className={styles.partyTag} style={{ color: partyColor(l.party) }}>
            {l.party ?? '—'}
          </span>
          {l.district ? ` · ${l.district}` : ''}
          {l.legislatureOrdinal ? ` · ${l.legislatureOrdinal}th Legislature` : ''}
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          <section className={styles.section}>
            <div className="eyebrow">Sponsored bills ({l.sponsoredBills.length})</div>
            {l.sponsoredBills.length === 0 ? (
              <EmptyState message="No sponsored bills on record." />
            ) : (
              <div className={styles.billList}>
                {l.sponsoredBills.map((b) => (
                  <Link key={b.id} to={`/bills/${b.id}`} className={styles.billRow}>
                    <span className={styles.billIdentifier}>{b.identifier}</span>
                    <span className={styles.billTitle}>{b.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className="eyebrow">Recent floor votes</div>
            <div className={styles.tallyRow}>
              <div>
                <div className={styles.tallyStat} style={{ color: 'var(--teal)' }}>
                  {l.recentVotesTally.yes}
                </div>
                <div className={styles.tallyLabel}>Yes</div>
              </div>
              <div>
                <div className={styles.tallyStat} style={{ color: 'var(--accent, #b9723d)' }}>
                  {l.recentVotesTally.no}
                </div>
                <div className={styles.tallyLabel}>No</div>
              </div>
              {l.recentVotesTally.other > 0 && (
                <div>
                  <div className={styles.tallyStat}>{l.recentVotesTally.other}</div>
                  <div className={styles.tallyLabel}>Other</div>
                </div>
              )}
            </div>
            {l.recentVotes.length === 0 ? (
              <EmptyState message="No recorded floor votes." />
            ) : (
              <div className={styles.billList} style={{ marginTop: 12 }}>
                {l.recentVotes.map((v, i) => (
                  <Link key={i} to={`/bills/${v.id}`} className={styles.voteRow}>
                    <span
                      className={styles.voteType}
                      style={{ color: (v.voteType ?? '').toUpperCase().startsWith('YES') ? 'var(--teal)' : 'var(--accent, #b9723d)' }}
                    >
                      {v.voteType ?? '—'}
                    </span>
                    <span className={styles.billIdentifier}>{v.identifier}</span>
                    <span style={{ color: 'var(--faint)', fontSize: 14 }}>{v.occurredAt ? formatDate(v.occurredAt) : ''}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className={styles.sideCol}>
          <section className={styles.section}>
            <div className="eyebrow">Committees ({l.committees.length})</div>
            {l.committees.length === 0 ? (
              <EmptyState message="No committee memberships on record." />
            ) : (
              l.committees.map((c, i) => (
                <div key={i} className={styles.committeeRow}>
                  <span>{c.name}</span>
                  <span style={{ color: 'var(--faint)' }}>{c.role}</span>
                </div>
              ))
            )}
          </section>

          <section className={styles.section}>
            <div className="eyebrow">Cosponsored bills ({l.cosponsoredBills.length})</div>
            {l.cosponsoredBills.length === 0 ? (
              <EmptyState message="No cosponsored bills on record." />
            ) : (
              <div className={styles.billList}>
                {l.cosponsoredBills.slice(0, 15).map((b) => (
                  <Link key={b.id} to={`/bills/${b.id}`} className={styles.billRow}>
                    <span className={styles.billIdentifier}>{b.identifier}</span>
                    <span className={styles.billTitle}>{b.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
