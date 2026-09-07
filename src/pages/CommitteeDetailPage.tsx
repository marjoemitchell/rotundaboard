import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as client from '../data/client'
import type { CommitteeMeeting, LoadState, NonStandingCommitteeDetail } from '../types'
import { formatDate, formatTime } from '../lib/format'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './CommitteeDetailPage.module.css'

function MeetingRow({ meeting }: { meeting: CommitteeMeeting }) {
  const [expanded, setExpanded] = useState(false)
  const isPast = meeting.meetingTime ? new Date(meeting.meetingTime).getTime() < Date.now() : false

  return (
    <div className={styles.meetingRow}>
      <button className={styles.meetingHead} onClick={() => setExpanded((e) => !e)}>
        <div>
          <div className={styles.meetingDate}>
            {meeting.meetingTime ? `${formatDate(meeting.meetingTime)}, ${formatTime(meeting.meetingTime)}` : 'Date TBD'}
            {isPast && <span className={styles.pastBadge}>Past</span>}
          </div>
          <div className={styles.meetingMeta}>
            {meeting.location?.trim() || 'Location TBD'}
            {meeting.publicParticipation ? ' · Open to public comment' : ''}
          </div>
        </div>
        {meeting.agendaItems.length > 0 && (
          <span className={styles.agendaToggle}>{expanded ? 'Hide agenda' : `${meeting.agendaItems.length} agenda items`}</span>
        )}
      </button>
      {expanded && meeting.agendaItems.length > 0 && (
        <ol className={styles.agendaList}>
          {meeting.agendaItems.map((a) => (
            <li key={a.id} className={styles.agendaItem}>
              <span className={styles.agendaTitle}>{a.title.trim()}</span>
              {a.description.trim() && <span className={styles.agendaDescription}>{a.description.trim()}</span>}
            </li>
          ))}
        </ol>
      )}
      {meeting.comments?.trim() && <p className={styles.meetingComments}>{meeting.comments.trim()}</p>}
    </div>
  )
}

export function CommitteeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<LoadState<NonStandingCommitteeDetail>>({ status: 'loading' })

  const load = () => {
    if (!id) return
    client
      .getCommitteeDetail(id)
      .then((data) => setDetail({ status: 'ready', data }))
      .catch(() => setDetail({ status: 'empty' }))
  }

  useEffect(load, [id])

  if (detail.status === 'loading') {
    return <div className={styles.page}>Loading committee…</div>
  }
  if (detail.status === 'empty') {
    return (
      <div className={styles.page}>
        <button className={styles.backLink} onClick={() => navigate(-1)}>
          ← Back
        </button>
        <EmptyState message="This committee couldn't be found." />
      </div>
    )
  }

  const committee = detail.data
  const now = Date.now()
  const upcoming = committee.meetings
    .filter((m) => m.meetingTime && new Date(m.meetingTime).getTime() >= now)
    // committee.meetings comes from the API sorted newest-first (right for
    // "past", since you want the most recent past meeting on top) — upcoming
    // needs the opposite: soonest meeting first, not furthest away.
    .sort((a, b) => new Date(a.meetingTime!).getTime() - new Date(b.meetingTime!).getTime())
  const past = committee.meetings.filter((m) => !m.meetingTime || new Date(m.meetingTime).getTime() < now)

  const handleToggleFollow = async () => {
    if (committee.isFollowed) await client.unfollowCommittee(committee.id)
    else await client.followCommittee(committee.id)
    load()
  }

  return (
    <div className={styles.page}>
      <Link to="/committees" className={styles.backLink}>
        ← Back to interim committees
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{committee.name}</h1>
          <div className={styles.subtitle}>{committee.committeeType ?? 'Committee'}</div>
        </div>
        <div className={styles.headerActions}>
          <a
            className={styles.officialLink}
            href={`https://committees.legmt.gov/#/nonStandingCommittees/${committee.id}`}
            target="_blank"
            rel="noreferrer"
          >
            View on official site ↗
          </a>
          <button
            className={`${styles.followButton} ${committee.isFollowed ? styles.followButtonActive : ''}`}
            onClick={handleToggleFollow}
          >
            {committee.isFollowed ? 'Following' : '+ Follow'}
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          {committee.meetingMaterialsHtml && (
            <section className={styles.section}>
              <div className="eyebrow">Meeting materials</div>
              <div
                className={styles.materials}
                // Sanitized server-side before storage (see
                // scrapeCommitteeMaterials in server/src/scrape.ts) — this
                // is legmt.gov's own published content, not user input.
                dangerouslySetInnerHTML={{ __html: committee.meetingMaterialsHtml }}
              />
            </section>
          )}

          <section className={styles.section}>
            <div className="eyebrow">Upcoming meetings</div>
            {upcoming.length === 0 ? (
              <EmptyState message="No upcoming meetings scheduled." />
            ) : (
              upcoming.map((m) => <MeetingRow key={m.id} meeting={m} />)
            )}
          </section>

          {past.length > 0 && (
            <section className={styles.section}>
              <div className="eyebrow">Past meetings</div>
              {past.map((m) => (
                <MeetingRow key={m.id} meeting={m} />
              ))}
            </section>
          )}
        </div>

        <div className={styles.sideCol}>
          <section className={styles.section}>
            <div className="eyebrow">Members ({committee.members.length})</div>
            <div className={styles.memberList}>
              {committee.members.map((m, i) => (
                <div key={m.legislatorId ?? i} className={styles.memberRow}>
                  <span>
                    {m.legislatorId ? (
                      <Link to={`/legislators/${m.legislatorId}`} className={styles.memberName}>
                        {m.name}
                      </Link>
                    ) : (
                      m.name
                    )}
                    {m.party ? ` (${m.party})` : ''}
                  </span>
                  {m.roleName && <span className={styles.memberRole}>{m.roleName}</span>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
