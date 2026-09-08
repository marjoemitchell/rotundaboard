import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as client from '../data/client'
import type {
  BillDetail,
  BillVote,
  ExecutiveAction,
  LoadState,
  Note,
  Position,
  Tag,
  TeamMember,
  Testimony,
  TestimonyStatus,
} from '../types'
import { formatDate, formatSignedDelta, formatTime } from '../lib/format'
import { InitialsSquare } from '../components/shared/InitialsSquare'
import { PositionChip } from '../components/shared/PositionChip'
import { Sparkline } from '../components/shared/Sparkline'
import { EmptyState } from '../components/shared/EmptyState'
import { Tooltip } from '../components/shared/Tooltip'
import { MOMENTUM_EXPLANATION } from '../components/shared/MomentumBar'
import { OutcomeBadge } from '../components/shared/OutcomeBadge'
import styles from './BillDetailPage.module.css'

function formatDraftNumber(draftNumber: string): string {
  const match = draftNumber.match(/^([A-Za-z]+)(\d+)$/)
  return match ? `${match[1]} ${match[2]}` : draftNumber
}

// Committee-vote motions come through as a fixed vocabulary of snake_case
// codes ("do_pass", "do_concur", "be_amended"...); floor-vote motions are
// already free text ("AMD-HB0259.001.002 Seckinger DO PASS") and shouldn't
// be touched, so only reformat when it actually looks like one of the codes.
function formatMotion(motion: string | null): string {
  if (!motion) return 'Vote'
  if (!motion.includes('_')) return motion
  return motion
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const POSITION_OPTIONS: { value: NonNullable<Position>; label: string }[] = [
  { value: 'support', label: 'Support' },
  { value: 'oppose', label: 'Oppose' },
  { value: 'watch', label: 'Watch' },
  { value: 'neutral', label: 'Neutral' },
]

function useBillDetail(id: string | undefined): [LoadState<BillDetail>, () => void] {
  const [state, setState] = useState<LoadState<BillDetail>>({ status: 'loading' })

  const load = () => {
    if (!id) return
    setState({ status: 'loading' })
    client
      .getBillDetail(id)
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'empty' }))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id])

  return [state, load]
}

function VoteTallyBar({ tally }: { tally: { yes: number; no: number; other: number } }) {
  const total = tally.yes + tally.no + tally.other || 1
  return (
    <div className={styles.tallyBar}>
      <span className={styles.tallyYes} style={{ width: `${(tally.yes / total) * 100}%` }} />
      <span className={styles.tallyNo} style={{ width: `${(tally.no / total) * 100}%` }} />
    </div>
  )
}

function RollCall({ votes }: { votes: { legislatorId: number; name: string; party: string | null; voteType: string | null }[] }) {
  const [expanded, setExpanded] = useState(false)
  if (votes.length === 0) return null
  const visible = expanded ? votes : votes.slice(0, 6)
  return (
    <div className={styles.rollCall}>
      {visible.map((v) => (
        <span key={v.legislatorId} className={styles.rollCallEntry}>
          {v.name} ({v.party}) — <strong>{v.voteType ?? '—'}</strong>
        </span>
      ))}
      {votes.length > 6 && (
        <button className={styles.rollCallToggle} onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show all ${votes.length} votes`}
        </button>
      )}
    </div>
  )
}

const STATUS_HISTORY_COLLAPSED_COUNT = 8

function StatusHistory({ history }: { history: BillDetail['statusHistory'] }) {
  const [expanded, setExpanded] = useState(false)
  const hasMore = history.length > STATUS_HISTORY_COLLAPSED_COUNT
  const visible = expanded ? history : history.slice(-STATUS_HISTORY_COLLAPSED_COUNT)

  return (
    <>
      {hasMore && !expanded && (
        <button className={styles.rollCallToggle} onClick={() => setExpanded(true)}>
          Show all {history.length} events (from {formatDate(history[0].occurredAt)})
        </button>
      )}
      <div className={styles.timeline}>
        {visible.map((s) => (
          <div key={s.id} className={styles.timelineRow}>
            <span className={styles.timelineDate}>{formatDate(s.occurredAt)}</span>
            <div className={styles.timelineBody}>
              <span className={styles.timelineStatus}>{s.status}</span>
              {(s.committee || s.progressCategory) && (
                <span className={styles.timelineMeta}>
                  {[s.committee, s.progressCategory].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {hasMore && expanded && (
        <button className={styles.rollCallToggle} onClick={() => setExpanded(false)}>
          Show fewer
        </button>
      )}
    </>
  )
}

function VoteCard({ vote, kind }: { vote: BillVote | ExecutiveAction; kind: 'floor' | 'committee' }) {
  const committee = 'committee' in vote ? vote.committee : null
  const when = 'occurredAt' in vote ? vote.occurredAt : vote.voteTime
  return (
    <div className={styles.voteCard}>
      <div className={styles.voteCardHead}>
        <span className={styles.voteMotion}>{formatMotion(vote.motion)}</span>
        <span className={styles.voteMeta}>
          {kind === 'floor' ? ('chamber' in vote ? vote.chamber : null) : committee}
          {when ? ` · ${formatDate(when)}` : ''}
        </span>
      </div>
      <div className={styles.voteTallyRow}>
        <VoteTallyBar tally={vote.tally} />
        <span className={styles.tallyNumbers}>
          {vote.tally.yes}–{vote.tally.no}
          {vote.tally.other > 0 ? ` (${vote.tally.other} other)` : ''}
        </span>
      </div>
      <RollCall votes={vote.legislatorVotes} />
    </div>
  )
}

function TagsSection({ billId }: { billId: string }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    client.getBillTags(billId).then(setTags).catch(() => setTags([]))
  }

  useEffect(load, [billId])

  const handleAdd = async () => {
    if (!draft.trim()) return
    setSaving(true)
    try {
      await client.tagBill(billId, draft.trim())
      setDraft('')
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (tagId: string) => {
    await client.untagBill(billId, tagId)
    load()
  }

  return (
    <section className={styles.section}>
      <div className="eyebrow">Tags</div>
      <div className={styles.tagList}>
        {tags.map((t) => (
          <span key={t.id} className={styles.tagChip}>
            {t.name}
            <button className={styles.tagRemove} onClick={() => handleRemove(t.id)} aria-label={`Remove tag ${t.name}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className={styles.tagComposer}>
        <input
          className={styles.tagInput}
          placeholder="Add a tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className={styles.tagAddButton} onClick={handleAdd} disabled={saving || !draft.trim()}>
          Add
        </button>
      </div>
      <p className={styles.tagHint}>Tags can be pulled into subject watches to catch other bills like this one.</p>
    </section>
  )
}

const TESTIMONY_STATUS_OPTIONS: { value: TestimonyStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'delivered', label: 'Delivered' },
]

function TestimonySection({ bill }: { bill: BillDetail }) {
  const [items, setItems] = useState<LoadState<Testimony[]>>({ status: 'loading' })
  const [composing, setComposing] = useState(false)
  const [hearingId, setHearingId] = useState('')
  const [position, setPosition] = useState<NonNullable<Position> | ''>((bill.position ?? '') as NonNullable<Position> | '')
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    client
      .getBillTestimony(bill.id)
      .then((data) => setItems(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setItems({ status: 'empty' }))
  }

  useEffect(load, [bill.id])

  const handleAdd = async () => {
    if (!draft.trim() && !file) return
    setSaving(true)
    try {
      const { id } = await client.createTestimony({
        billId: bill.id,
        committeeMeetingId: hearingId || null,
        position: position || null,
        body: draft.trim(),
      })
      if (file) await client.uploadTestimonyAttachment(id, file)
      setDraft('')
      setFile(null)
      setComposing(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (id: string, status: TestimonyStatus) => {
    await client.updateTestimony(id, { status })
    load()
  }

  const handleDelete = async (id: string) => {
    await client.deleteTestimony(id)
    load()
  }

  const handleAttach = async (id: string, chosen: File | null) => {
    if (!chosen) return
    await client.uploadTestimonyAttachment(id, chosen)
    load()
  }

  const handleRemoveAttachment = async (id: string) => {
    await client.deleteTestimonyAttachment(id)
    load()
  }

  return (
    <section className={styles.section}>
      <div className={styles.testimonyHead}>
        <div className="eyebrow">Testimony</div>
        {!composing && (
          <button className={styles.testimonyAddLink} onClick={() => setComposing(true)}>
            + Draft
          </button>
        )}
      </div>

      {composing && (
        <div className={styles.testimonyComposer}>
          <div className={styles.testimonyComposerRow}>
            <select
              className={styles.testimonySelect}
              value={position}
              onChange={(e) => setPosition(e.target.value as NonNullable<Position> | '')}
            >
              <option value="">No position</option>
              <option value="support">Support</option>
              <option value="oppose">Oppose</option>
              <option value="watch">Watch</option>
              <option value="neutral">Neutral</option>
            </select>
            <select className={styles.testimonySelect} value={hearingId} onChange={(e) => setHearingId(e.target.value)}>
              <option value="">{bill.hearings.length === 0 ? 'No hearings scheduled' : 'No hearing linked'}</option>
              {bill.hearings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.committee} {h.datetime ? `· ${formatDate(h.datetime)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className={styles.noteInput}
            placeholder="Draft the testimony, or attach an already-written file below…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
          />
          <div className={styles.testimonyFileRow}>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              className={styles.testimonyFileInput}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <button className={styles.noteDelete} onClick={() => setFile(null)}>
                Remove
              </button>
            )}
          </div>
          <div className={styles.testimonyComposerActions}>
            <button className={styles.noteDelete} onClick={() => setComposing(false)} aria-label="Cancel">
              Cancel
            </button>
            <button className={styles.noteAddButton} onClick={handleAdd} disabled={saving || (!draft.trim() && !file)}>
              Save draft
            </button>
          </div>
        </div>
      )}

      {items.status === 'ready' && (
        <div className={styles.noteList}>
          {items.data.map((t) => (
            <div key={t.id} className={styles.noteRow}>
              <div className={styles.noteRowHead}>
                <span>
                  <strong>{t.authorName ?? 'Unknown'}</strong> · {formatDate(t.createdAt)}
                  {t.committeeName && t.hearingTime ? ` · ${t.committeeName}, ${formatDate(t.hearingTime)}` : ''}
                </span>
                <button className={styles.noteDelete} onClick={() => handleDelete(t.id)} aria-label="Delete testimony">
                  ×
                </button>
              </div>
              {t.body && <p className={styles.noteBody}>{t.body}</p>}
              <div className={styles.testimonyAttachmentRow}>
                {t.attachmentFilename ? (
                  <>
                    <a className={styles.testimonyAttachmentLink} href={client.getTestimonyAttachmentUrl(t.id)}>
                      📎 {t.attachmentFilename}
                    </a>
                    <button className={styles.noteDelete} onClick={() => handleRemoveAttachment(t.id)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    className={styles.testimonyFileInput}
                    onChange={(e) => handleAttach(t.id, e.target.files?.[0] ?? null)}
                  />
                )}
              </div>
              <select
                className={styles.testimonyStatusSelect}
                value={t.status}
                onChange={(e) => handleStatusChange(t.id, e.target.value as TestimonyStatus)}
              >
                {TESTIMONY_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function NotesSection({ billId }: { billId: string }) {
  const [notes, setNotes] = useState<LoadState<Note[]>>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    client
      .getBillNotes(billId)
      .then((data) => setNotes(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setNotes({ status: 'empty' }))
  }

  useEffect(load, [billId])

  const handleAdd = async () => {
    if (!draft.trim()) return
    setSaving(true)
    try {
      await client.createNote({ billId, body: draft.trim() })
      setDraft('')
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await client.deleteNote(id)
    load()
  }

  return (
    <section className={styles.section}>
      <div className="eyebrow">Notes</div>
      <div className={styles.noteComposer}>
        <textarea
          className={styles.noteInput}
          placeholder="Add a note about this bill…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
        />
        <button className={styles.noteAddButton} onClick={handleAdd} disabled={saving || !draft.trim()}>
          Add
        </button>
      </div>
      {notes.status === 'ready' && (
        <div className={styles.noteList}>
          {notes.data.map((n) => (
            <div key={n.id} className={styles.noteRow}>
              <div className={styles.noteRowHead}>
                <span>
                  <strong>{n.authorName ?? 'Unknown'}</strong> · {formatDate(n.createdAt)}, {formatTime(n.createdAt)}
                </span>
                <button className={styles.noteDelete} onClick={() => handleDelete(n.id)} aria-label="Delete note">
                  ×
                </button>
              </div>
              <p className={styles.noteBody}>{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function BillDetailPage({
  teamMembers,
  onChangePosition,
  onChangeAssignee,
  onTrackBill,
  onUntrackBill,
}: {
  teamMembers: LoadState<TeamMember[]>
  onChangePosition: (billId: string, position: Position) => void
  onChangeAssignee: (billId: string, assigneeId: string | null) => void
  onTrackBill: (billId: string) => void
  onUntrackBill: (billId: string) => void
}) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, refetch] = useBillDetail(id)

  if (detail.status === 'loading') {
    return <div className={styles.page}>Loading bill…</div>
  }
  if (detail.status === 'empty') {
    return (
      <div className={styles.page}>
        <button className={styles.backLink} onClick={() => navigate(-1)}>
          ← Back
        </button>
        <EmptyState message="This bill couldn't be found." />
      </div>
    )
  }

  const bill = detail.data
  const assignee =
    teamMembers.status === 'ready' ? (teamMembers.data.find((m) => m.id === bill.assigneeId) ?? null) : null

  const handlePositionChange = (position: Position) => {
    onChangePosition(bill.id, position)
    setTimeout(refetch, 300)
  }
  const handleAssigneeChange = (assigneeId: string | null) => {
    onChangeAssignee(bill.id, assigneeId)
    setTimeout(refetch, 300)
  }
  const handleTrack = () => {
    onTrackBill(bill.id)
    setTimeout(refetch, 300)
  }
  const handleUntrack = () => {
    onUntrackBill(bill.id)
    setTimeout(refetch, 300)
  }

  return (
    <div className={styles.page}>
      <button className={styles.backLink} onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className={styles.header}>
        <div>
          <div className={styles.identifierRow}>
            <span className={styles.identifier}>{bill.identifier}</span>
            {!bill.identifier.startsWith('LC') && (
              <span className={styles.draftNumber}>{formatDraftNumber(bill.draftNumber)}</span>
            )}
            {bill.officialUrl && (
              <a className={styles.officialLink} href={bill.officialUrl} target="_blank" rel="noreferrer">
                View on official site ↗
              </a>
            )}
          </div>
          <h1 className={styles.title}>{bill.title}</h1>
        </div>
        <div className={styles.headerControls}>
          {bill.isTracked ? (
            <>
              <label className={styles.controlLabel}>
                Position
                <select
                  className={styles.editableSelect}
                  value={bill.position ?? ''}
                  onChange={(e) => handlePositionChange((e.target.value || null) as Position)}
                >
                  <option value="">No position</option>
                  {POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.controlLabel}>
                Assignee
                <span className={styles.assigneeControl}>
                  <InitialsSquare member={assignee} size={22} />
                  <select
                    className={styles.editableSelect}
                    value={bill.assigneeId ?? ''}
                    onChange={(e) => handleAssigneeChange(e.target.value || null)}
                  >
                    <option value="">Unassigned</option>
                    {teamMembers.status === 'ready' &&
                      teamMembers.data.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </span>
              </label>
              <button className={styles.untrackButton} onClick={handleUntrack}>
                Stop tracking
              </button>
            </>
          ) : (
            <div className={styles.trackPrompt}>
              <span className={styles.controlLabel}>Not on your tracked list</span>
              <button className={styles.trackButton} onClick={handleTrack}>
                + Track this bill
              </button>
            </div>
          )}
        </div>
      </div>

      {bill.aiSummary && (
        <div className={styles.aiSummary}>
          <div className={styles.aiSummaryHead}>
            <span className={styles.aiSummaryEyebrow}>AI-generated summary</span>
            {bill.aiSummary.generatedAt && (
              <span className={styles.aiSummaryMeta}>Generated {formatDate(bill.aiSummary.generatedAt)}</span>
            )}
          </div>
          <p className={styles.aiSummaryText}>{bill.aiSummary.text}</p>
          <p className={styles.aiSummaryDisclaimer}>
            Generated by AI from bill metadata only (title, subject, sponsor, status) — not the full bill
            text, which isn't available in this tool yet. This may be incomplete or wrong. Verify against the
            official bill record before relying on it.
          </p>
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          <section className={styles.section}>
            <div className="eyebrow">Status history</div>
            <StatusHistory history={bill.statusHistory} />
          </section>

          {bill.votes.length > 0 && (
            <section className={styles.section}>
              <div className="eyebrow">Floor votes</div>
              {bill.votes.map((v) => (
                <VoteCard key={v.id} vote={v} kind="floor" />
              ))}
            </section>
          )}

          {bill.executiveActions.length > 0 && (
            <section className={styles.section}>
              <div className="eyebrow">Committee votes</div>
              {bill.executiveActions.map((a) => (
                <VoteCard key={a.id} vote={a} kind="committee" />
              ))}
            </section>
          )}
        </div>

        <div className={styles.sideCol}>
          <section className={styles.section}>
            <div className="eyebrow">Sponsor</div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Name</span>
              <span className={styles.rowValue}>{bill.sponsor.name || 'Not yet assigned'}</span>
            </div>
            {bill.sponsor.district && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>District</span>
                <span className={styles.rowValue}>
                  {bill.sponsor.district}
                  {bill.sponsor.party ? ` (${bill.sponsor.party})` : ''}
                </span>
              </div>
            )}
            {bill.committee && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Committee</span>
                <span className={styles.rowValue}>{bill.committee}</span>
              </div>
            )}
            {bill.subjects.length > 0 && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>{bill.subjects.length > 1 ? 'Subjects' : 'Subject'}</span>
                <span className={styles.rowValue}>{bill.subjects.join(', ')}</span>
              </div>
            )}
            <div className={styles.row}>
              <span className={styles.rowLabel}>Position</span>
              <PositionChip position={bill.position} />
            </div>
          </section>

          <section className={styles.section}>
            {bill.outcome ? (
              <>
                <div className="eyebrow">Outcome</div>
                <div className={styles.momentumHead}>
                  <OutcomeBadge outcome={bill.outcome} />
                </div>
              </>
            ) : (
              <>
                <Tooltip label={MOMENTUM_EXPLANATION}>
                  <div className="eyebrow">Momentum ⓘ</div>
                </Tooltip>
                <div className={styles.momentumHead}>
                  <span className={styles.momentumScore}>{bill.momentum.score}</span>
                  <span
                    className={styles.momentumDelta}
                    style={{ color: bill.momentum.delta7d >= 0 ? 'var(--teal)' : 'var(--accent, #b9723d)' }}
                  >
                    {formatSignedDelta(bill.momentum.delta7d)} / 7d
                  </span>
                </div>
                <Sparkline history={bill.momentum.history} color="var(--low)" />
              </>
            )}
          </section>

          {bill.cosponsors.length > 0 && (
            <section className={styles.section}>
              <div className="eyebrow">Cosponsors ({bill.cosponsors.length})</div>
              <div className={styles.cosponsorList}>
                {bill.cosponsors.map((c) => (
                  <div key={c.legislatorId} className={styles.cosponsorRow}>
                    <span>{c.name}</span>
                    <span className={styles.rowLabel}>
                      {c.district ? `${c.district} ` : ''}
                      {c.party ? `(${c.party})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {bill.hearings.length > 0 && (
            <section className={styles.section}>
              <div className="eyebrow">Hearings</div>
              {bill.hearings.map((h) => (
                <div key={h.id} className={styles.row}>
                  <span className={styles.rowLabel}>{h.committee}</span>
                  <span className={styles.rowValue}>{h.datetime ? formatDate(h.datetime) : '—'}</span>
                </div>
              ))}
            </section>
          )}

          {bill.amendments.length > 0 && (
            <section className={styles.section}>
              <div className="eyebrow">Amendments ({bill.amendments.length})</div>
              {bill.amendments.map((a) => (
                <div key={a.id} className={styles.row}>
                  <span className={styles.rowLabel}>
                    #{a.number} {a.type ? `(${a.type})` : ''}
                  </span>
                  <span className={styles.rowValue}>{a.billVersion ? `v${a.billVersion}` : ''}</span>
                </div>
              ))}
            </section>
          )}

          <TagsSection billId={bill.id} />

          <TestimonySection bill={bill} />

          <NotesSection billId={bill.id} />
        </div>
      </div>
    </div>
  )
}
