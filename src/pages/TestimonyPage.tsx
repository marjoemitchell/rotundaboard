import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { Bill, BillDetail, LoadState, Position, Testimony, TestimonyStatus } from '../types'
import { formatDate, formatTime } from '../lib/format'
import { PositionChip } from '../components/shared/PositionChip'
import { EmptyState } from '../components/shared/EmptyState'
import { useConfirm, type ConfirmFn } from '../hooks/useConfirm'
import styles from './TestimonyPage.module.css'

const POSITION_OPTIONS: { value: NonNullable<Position>; label: string }[] = [
  { value: 'support', label: 'Support' },
  { value: 'oppose', label: 'Oppose' },
  { value: 'watch', label: 'Watch' },
  { value: 'neutral', label: 'Neutral' },
]

const STATUS_OPTIONS: { value: TestimonyStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'delivered', label: 'Delivered' },
]

function NewTestimonyForm({
  trackedBills,
  onCancel,
  onCreated,
}: {
  trackedBills: Bill[]
  onCancel: () => void
  onCreated: () => void
}) {
  const [billId, setBillId] = useState('')
  const [billDetail, setBillDetail] = useState<BillDetail | null>(null)
  const [committeeMeetingId, setCommitteeMeetingId] = useState('')
  const [position, setPosition] = useState<NonNullable<Position> | ''>('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!billId) {
      setBillDetail(null)
      return
    }
    client
      .getBillDetail(billId)
      .then((detail) => {
        setBillDetail(detail)
        setCommitteeMeetingId('')
        setPosition((detail.position ?? '') as NonNullable<Position> | '')
      })
      .catch(() => setBillDetail(null))
  }, [billId])

  const canSave = billId !== '' && (body.trim().length > 0 || file !== null)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const { id } = await client.createTestimony({
        billId,
        committeeMeetingId: committeeMeetingId || null,
        position: position || null,
        body: body.trim(),
      })
      if (file) await client.uploadTestimonyAttachment(id, file)
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Bill</label>
        <select className={styles.formInput} value={billId} onChange={(e) => setBillId(e.target.value)}>
          <option value="">Select a tracked bill…</option>
          {trackedBills.map((b) => (
            <option key={b.id} value={b.id}>
              {b.identifier} — {b.title}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.formGrid}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Position</label>
          <select
            className={styles.formInput}
            value={position}
            onChange={(e) => setPosition(e.target.value as NonNullable<Position> | '')}
          >
            <option value="">No position</option>
            {POSITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Hearing (optional)</label>
          <select
            className={styles.formInput}
            value={committeeMeetingId}
            onChange={(e) => setCommitteeMeetingId(e.target.value)}
            disabled={!billDetail || billDetail.hearings.length === 0}
          >
            <option value="">
              {billDetail && billDetail.hearings.length === 0 ? 'No hearings scheduled yet' : 'Not linked to a hearing'}
            </option>
            {billDetail?.hearings.map((h) => (
              <option key={h.id} value={h.id}>
                {h.committee} {h.datetime ? `· ${formatDate(h.datetime)}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel}>Testimony</label>
        <textarea
          className={styles.formTextarea}
          placeholder="Draft the statement, or skip this and attach an already-written file below…"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className={styles.fileRow}>
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className={styles.fileInput}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <button className={styles.fileClear} onClick={() => setFile(null)}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className={styles.formActions}>
        <button className={styles.cancelButton} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className={styles.saveButton} onClick={handleSave} disabled={!canSave || saving}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </div>
  )
}

function TestimonyRow({
  item,
  onChanged,
  confirm,
}: {
  item: Testimony
  onChanged: () => void
  confirm: ConfirmFn
}) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(item.body)
  const [saving, setSaving] = useState(false)

  const handleStatusChange = async (status: TestimonyStatus) => {
    await client.updateTestimony(item.id, { status })
    onChanged()
  }

  const handleSaveBody = async () => {
    setSaving(true)
    try {
      await client.updateTestimony(item.id, { body: draft })
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!(await confirm('Delete this testimony?', { confirmLabel: 'Delete' }))) return
    await client.deleteTestimony(item.id)
    onChanged()
  }

  const handleAttach = async (file: File | null) => {
    if (!file) return
    await client.uploadTestimonyAttachment(item.id, file)
    onChanged()
  }

  const handleRemoveAttachment = async () => {
    await client.deleteTestimonyAttachment(item.id)
    onChanged()
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <div className={styles.rowMain}>
          <Link to={`/bills/${item.billId}`} className={styles.billLink}>
            {item.billIdentifier}
          </Link>
          <span className={styles.billTitle}>{item.billTitle}</span>
        </div>
        <div className={styles.rowMeta}>
          <PositionChip position={item.position} />
          <select
            className={styles.statusSelect}
            value={item.status}
            onChange={(e) => handleStatusChange(e.target.value as TestimonyStatus)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button className={styles.deleteButton} onClick={handleDelete} aria-label="Delete testimony">
            ×
          </button>
        </div>
      </div>

      <div className={styles.rowSub}>
        {item.committeeName && item.hearingTime
          ? `${item.committeeName} · ${formatDate(item.hearingTime)}, ${formatTime(item.hearingTime)}`
          : 'Not linked to a hearing yet'}
        {' · '}
        {item.authorName ?? 'Unknown'}
      </div>

      <div className={styles.attachmentRow}>
        {item.attachmentFilename ? (
          <>
            <a className={styles.attachmentLink} href={client.getTestimonyAttachmentUrl(item.id)}>
              📎 {item.attachmentFilename}
            </a>
            <button className={styles.fileClear} onClick={handleRemoveAttachment}>
              Remove
            </button>
          </>
        ) : (
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className={styles.fileInput}
            onChange={(e) => handleAttach(e.target.files?.[0] ?? null)}
          />
        )}
      </div>

      {!expanded ? (
        <button className={styles.bodyPreview} onClick={() => setExpanded(true)}>
          {item.body || (item.attachmentFilename ? '(No body text — see attached file.)' : 'No text yet — click to write.')}
        </button>
      ) : (
        <div className={styles.editArea}>
          <textarea className={styles.editTextarea} rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className={styles.editActions}>
            <button className={styles.cancelButton} onClick={() => setExpanded(false)}>
              Close
            </button>
            <button className={styles.saveButton} onClick={handleSaveBody} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TestimonyPage() {
  const [testimony, setTestimony] = useState<LoadState<Testimony[]>>({ status: 'loading' })
  const [trackedBills, setTrackedBills] = useState<Bill[]>([])
  const [creating, setCreating] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  const load = () => {
    client
      .getTestimony()
      .then((data) => setTestimony(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setTestimony({ status: 'empty' }))
  }

  useEffect(() => {
    load()
    client.getBills().then(setTrackedBills).catch(() => setTrackedBills([]))
  }, [])

  const grouped = useMemo(() => {
    if (testimony.status !== 'ready') return null
    const groups: Record<TestimonyStatus, Testimony[]> = { draft: [], submitted: [], delivered: [] }
    for (const t of testimony.data) groups[t.status].push(t)
    return groups
  }, [testimony])

  const handleCreated = () => {
    setCreating(false)
    load()
  }

  return (
    <div className={styles.page}>
      {confirmDialog}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Testimony</h1>
          <p className={styles.subhead}>
            Written and oral statements the team has drafted for committee hearings, from first draft to delivered.
          </p>
        </div>
        {!creating && (
          <button className={styles.newButton} onClick={() => setCreating(true)}>
            + New testimony
          </button>
        )}
      </div>

      {creating && (
        <NewTestimonyForm trackedBills={trackedBills} onCancel={() => setCreating(false)} onCreated={handleCreated} />
      )}

      {testimony.status === 'loading' && <div className="skeleton" style={{ height: 200, marginTop: 16 }} />}
      {testimony.status === 'empty' && !creating && (
        <EmptyState message="No testimony drafted yet. Start one from a bill page or the button above." />
      )}

      {grouped &&
        STATUS_OPTIONS.map((opt) => {
          const items = grouped[opt.value]
          if (items.length === 0) return null
          return (
            <section key={opt.value} className={styles.section}>
              <div className={styles.sectionHead}>
                <span className="eyebrow">{opt.label}</span>
                <span className={styles.sectionCount}>{items.length}</span>
              </div>
              <div className={styles.list}>
                {items.map((item) => (
                  <TestimonyRow key={item.id} item={item} onChanged={load} confirm={confirm} />
                ))}
              </div>
            </section>
          )
        })}
    </div>
  )
}
