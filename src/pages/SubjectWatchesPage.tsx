import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, SessionBillSummary, SubjectCode, SubjectWatch, Tag } from '../types'
import { EmptyState } from '../components/shared/EmptyState'
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
        <label className={styles.formLabel}>Official subjects</label>
        <input
          className={styles.formInput}
          placeholder="Search subjects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.optionList}>
          {filteredSubjects.map((s) => (
            <label key={s.code} className={styles.optionRow}>
              <input type="checkbox" checked={selectedSubjects.has(s.code)} onChange={() => toggleSubject(s.code)} />
              {s.description}
            </label>
          ))}
          {filteredSubjects.length === 0 && <div className={styles.optionEmpty}>No subjects match “{query}”.</div>}
        </div>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel}>Your tags</label>
        {tags.length === 0 ? (
          <div className={styles.optionEmpty}>No custom tags yet — tag a bill from its detail page to create one.</div>
        ) : (
          <div className={styles.optionList}>
            {tags.map((t) => (
              <label key={t.id} className={styles.optionRow}>
                <input type="checkbox" checked={selectedTags.has(t.id)} onChange={() => toggleTag(t.id)} />
                {t.name}
                {t.usageCount ? <span className={styles.optionCount}>{t.usageCount}</span> : null}
              </label>
            ))}
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
  const [bills, setBills] = useState<LoadState<SessionBillSummary[]>>({ status: 'loading' })

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
          <span className={styles.matchTitle}>{b.title}</span>
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

export function SubjectWatchesPage() {
  const [watches, setWatches] = useState<LoadState<SubjectWatch[]>>({ status: 'loading' })
  const [subjectCodes, setSubjectCodes] = useState<SubjectCode[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadWatches = () => {
    client
      .getSubjectWatches()
      .then((data) => setWatches(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setWatches({ status: 'empty' }))
  }

  useEffect(() => {
    loadWatches()
    client.getSubjectCodes().then(setSubjectCodes).catch(() => setSubjectCodes([]))
    client.getTags().then(setTags).catch(() => setTags([]))
  }, [])

  const handleCreate = async (params: { name: string; subjectCodes: string[]; tagIds: string[] }) => {
    await client.createSubjectWatch(params)
    setCreating(false)
    loadWatches()
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete the "${name}" watch?`)) return
    await client.deleteSubjectWatch(id)
    if (expandedId === id) setExpandedId(null)
    loadWatches()
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Subject watches</h1>
          <p className={styles.subhead}>
            Track a topic, not just a bill — a watch surfaces every bill carrying a subject or tag you care about,
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
              {expandedId === w.id && <WatchBills watchId={w.id} onTracked={loadWatches} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
