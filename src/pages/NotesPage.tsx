import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, Note } from '../types'
import { formatDate, formatTime } from '../lib/format'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './NotesPage.module.css'

export function NotesPage() {
  const [notes, setNotes] = useState<LoadState<Note[]>>({ status: 'loading' })

  const load = () => {
    client
      .getNotes()
      .then((data) => setNotes(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setNotes({ status: 'empty' }))
  }

  useEffect(load, [])

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this note?')) return
    await client.deleteNote(id)
    load()
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Notes</h1>
      <p className={styles.subhead}>Everything the team has logged — bill notes and hearing clips, newest first.</p>

      {notes.status === 'loading' && <div className="skeleton" style={{ height: 200, marginTop: 16 }} />}
      {notes.status === 'empty' && <EmptyState message="No notes yet. Add one from a bill page or clip a hearing to notes." />}

      {notes.status === 'ready' && (
        <div className={styles.list}>
          {notes.data.map((n) => (
            <div key={n.id} className={styles.note}>
              <div className={styles.noteHead}>
                <span className={styles.noteMeta}>
                  <span className={styles.authorName}>{n.authorName ?? 'Unknown'}</span>
                  {formatDate(n.createdAt)}, {formatTime(n.createdAt)}
                </span>
                <button className={styles.deleteButton} onClick={() => handleDelete(n.id)} aria-label="Delete note">
                  ×
                </button>
              </div>
              <p className={styles.body}>{n.body}</p>
              {n.billId && (
                <Link className={styles.billLink} to={`/bills/${n.billId}`}>
                  {n.billIdentifier} {n.billTitle ? `— ${n.billTitle}` : ''}
                </Link>
              )}
              {n.sourceHearing && <div className={styles.sourceHearing}>From: {n.sourceHearing}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
