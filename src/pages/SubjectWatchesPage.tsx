import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, SubjectCode, SubjectWatch, SubjectWatchBillMatch, Tag, WatchSuggestions } from '../types'
import { EmptyState } from '../components/shared/EmptyState'
import { useConfirm } from '../hooks/useConfirm'
import styles from './SubjectWatchesPage.module.css'

function NewWatchForm({
  subjectCodes,
  tags,
  onCancel,
  onCreate,
}: {
  subjectCodes: SubjectCode[]
  tags: Tag[]
  onCancel: () => void
  onCreate: (params: { name: string; subjectCodes: string[]; tagIds: string[] }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set())
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const filteredSubjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return subjectCodes
    return subjectCodes.filter((s) => s.description.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
  }, [subjectCodes, query])

  const filteredTags = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, query])

  const toggleSubject = (code: string) => {
    setSelectedSubjects((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const toggleTag = (id: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSave = name.trim().length > 0 && (selectedSubjects.size > 0 || selectedTags.size > 0)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onCreate({ name: name.trim(), subjectCodes: [...selectedSubjects], tagIds: [...selectedTags] })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Name</label>
        <input
          className={styles.formInput}
          placeholder="e.g. Water rights"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="watch-subject-search">
          Subjects
        </label>
        <input
          id="watch-subject-search"
          className={styles.formInput}
          placeholder="Search subjects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* The custom subjects of the workspace come first, then the default subjects. */}
        <div className={styles.optionList} role="group" aria-label="Subjects">
          {filteredTags.length > 0 && <div className={styles.optionGroup}>Custom subjects</div>}
          {filteredTags.map((t) => (
            <label key={`custom:${t.id}`} className={styles.optionRow}>
              <input type="checkbox" checked={selectedTags.has(t.id)} onChange={() => toggleTag(t.id)} />
              {t.name}
              <span className={styles.optionCustom}>Custom</span>
              {t.usageCount ? <span className={styles.optionCount}>{t.usageCount}</span> : null}
            </label>
          ))}
          {filteredSubjects.length > 0 && <div className={styles.optionGroup}>Default subjects</div>}
          {filteredSubjects.map((s) => (
            <label key={s.code} className={styles.optionRow}>
              <input type="checkbox" checked={selectedSubjects.has(s.code)} onChange={() => toggleSubject(s.code)} />
              {s.description}
            </label>
          ))}
          {filteredSubjects.length === 0 && filteredTags.length === 0 && (
            <div className={styles.optionEmpty}>No subjects match “{query}”.</div>
          )}
        </div>
        {tags.length === 0 && (
          <div className={styles.optionEmpty}>
            No custom subjects yet. To make one, add a subject to a bill on the bill page.
          </div>
        )}
      </div>

      <div className={styles.formActions}>
        <button className={styles.cancelButton} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className={styles.saveButton} onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Saving…' : 'Create watch'}
        </button>
      </div>
    </div>
  )
}

function WatchBills({ watchId, onTracked }: { watchId: string; onTracked: () => void }) {
  const [bills, setBills] = useState<LoadState<SubjectWatchBillMatch[]>>({ status: 'loading' })

  const load = () => {
    client
      .getSubjectWatchBills(watchId)
      .then((data) => setBills(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setBills({ status: 'empty' }))
  }

  useEffect(load, [watchId])

  const handleTrack = async (billId: string) => {
    await client.trackBill(billId)
    load()
    onTracked()
  }

  if (bills.status === 'loading') return <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
  if (bills.status === 'empty') return <EmptyState message="No bills match this watch yet in the working session." />

  return (
    <div className={styles.matchList}>
      {bills.data.map((b) => (
        <div key={b.id} className={styles.matchRow}>
          <Link to={`/bills/${b.id}`} className={styles.matchIdentifier}>
            {b.identifier}
          </Link>
          <div className={styles.matchMain}>
            <span className={styles.matchTitle}>{b.title}</span>
            {b.matchedSubjects.length > 0 && (
              <span className={styles.matchReason} title={b.matchedSubjects.join(', ')}>
                via {b.matchedSubjects.join(', ')}
              </span>
            )}
          </div>
          <span className={styles.matchStatus}>{b.status}</span>
          {b.isTracked ? (
            <span className={styles.trackedBadge}>Tracked</span>
          ) : (
            <button className={styles.trackButton} onClick={() => handleTrack(b.id)}>
              + Track
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// Bills that the AI summaries match to the subject watches, and that the
// subject codes do not match. With no watches, the section does not show.
function WatchSuggestionsSection({ reloadKey, onTracked }: { reloadKey: number; onTracked: () => void }) {
  const [data, setData] = useState<WatchSuggestions | null>(null)

  const load = () => {
    client
      .getWatchSuggestions()
      .then(setData)
      .catch(() => setData(null))
  }

  useEffect(load, [reloadKey])

  if (!data || !data.hasWatches) return null

  const handleTrack = async (billId: string) => {
    // Remove the row at once. The next load shows the new list.
    setData((d) => (d ? { ...d, bills: d.bills.filter((b) => b.id !== billId) } : d))
    await client.trackBill(billId)
    load()
    onTracked()
  }

  return (
    <section className={styles.suggestions} aria-label="Suggested from AI summaries">
      <h2 className={styles.suggestionsTitle}>Suggested from AI summaries</h2>
      <p className={styles.suggestionsSubhead}>
        The AI summaries of these bills mention the subjects of your watches, but the bills do not have those
        subjects. AI summaries can be wrong. Read the bill before you track it.
      </p>
      {data.bills.length === 0 ? (
        <EmptyState message="No AI summaries match your watches yet." />
      ) : (
        <div className={styles.matchList}>
          {data.bills.map((b) => (
            <div key={b.id} className={styles.matchRow}>
              <Link to={`/bills/${b.id}`} className={styles.matchIdentifier}>
                {b.identifier}
              </Link>
              <div className={styles.matchMain}>
                <span className={styles.matchTitle}>{b.title}</span>
                <span className={styles.suggestionSummary}>{b.summary}</span>
                <span className={styles.matchReason} title={b.matchedSubjects.join(', ')}>
                  {b.watches.length === 1 ? 'Watch' : 'Watches'}: {b.watches.join(', ')}, via{' '}
                  {b.matchedSubjects.join(', ')}
                </span>
              </div>
              <span className={styles.matchStatus}>{b.status}</span>
              <button
                className={styles.trackButton}
                onClick={() => handleTrack(b.id)}
                aria-label={`Track ${b.identifier}`}
              >
                + Track
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function SubjectWatchesPage() {
  const [watches, setWatches] = useState<LoadState<SubjectWatch[]>>({ status: 'loading' })
  const [subjectCodes, setSubjectCodes] = useState<SubjectCode[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  // A change to the watches or to the tracked bills loads the suggestions again.
  const [suggestionsKey, setSuggestionsKey] = useState(0)

  const loadWatches = () => {
    client
      .getSubjectWatches()
      .then((data) => setWatches(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setWatches({ status: 'empty' }))
  }

  const refresh = () => {
    loadWatches()
    setSuggestionsKey((k) => k + 1)
  }

  useEffect(() => {
    loadWatches()
    client.getSubjectCodes().then(setSubjectCodes).catch(() => setSubjectCodes([]))
    client.getTags().then(setTags).catch(() => setTags([]))
  }, [])

  const handleCreate = async (params: { name: string; subjectCodes: string[]; tagIds: string[] }) => {
    await client.createSubjectWatch(params)
    setCreating(false)
    refresh()
  }

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirm(`Delete the "${name}" watch?`, { confirmLabel: 'Delete' }))) return
    await client.deleteSubjectWatch(id)
    if (expandedId === id) setExpandedId(null)
    refresh()
  }

  return (
    <div className={styles.page}>
      {confirmDialog}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Subject watches</h1>
          <p className={styles.subhead}>
            Track a topic, not just a bill — a watch surfaces every bill carrying a subject you care about,
            including ones you haven't seen yet.
          </p>
        </div>
        {!creating && (
          <button className={styles.newButton} onClick={() => setCreating(true)}>
            + New watch
          </button>
        )}
      </div>

      {creating && (
        <NewWatchForm subjectCodes={subjectCodes} tags={tags} onCancel={() => setCreating(false)} onCreate={handleCreate} />
      )}

      {watches.status === 'loading' && <div className="skeleton" style={{ height: 200, marginTop: 16 }} />}
      {watches.status === 'empty' && !creating && (
        <EmptyState message="No subject watches yet. Create one to catch bills on a topic before your team finds them by hand." />
      )}

      {watches.status === 'ready' && (
        <div className={styles.list}>
          {watches.data.map((w) => (
            <div key={w.id} className={styles.watchCard}>
              <div className={styles.watchHead}>
                <div>
                  <div className={styles.watchName}>{w.name}</div>
                  <div className={styles.chips}>
                    {w.subjectCodes.map((s) => (
                      <span key={s.code} className={styles.chip}>
                        {s.description}
                      </span>
                    ))}
                    {w.tags.map((t) => (
                      <span key={t.id} className={`${styles.chip} ${styles.chipTag}`}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.watchStats}>
                  <button
                    className={styles.matchCount}
                    onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}
                  >
                    {w.matchCount} matching{w.untrackedCount > 0 ? ` · ${w.untrackedCount} untracked` : ''}
                  </button>
                  <button className={styles.deleteButton} onClick={() => handleDelete(w.id, w.name)} aria-label={`Delete ${w.name}`}>
                    ×
                  </button>
                </div>
              </div>
              {expandedId === w.id && <WatchBills watchId={w.id} onTracked={refresh} />}
            </div>
          ))}
        </div>
      )}

      <WatchSuggestionsSection reloadKey={suggestionsKey} onTracked={loadWatches} />
    </div>
  )
}
