import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { AlertDelivery, AlertSource, AlertSourceType, LoadState, NotificationPreferences } from '../types'
import styles from './AlertSettings.module.css'

const DELIVERY_OPTIONS: { value: AlertDelivery; label: string; hint: string }[] = [
  { value: 'immediate', label: 'Right away', hint: 'One email after each data update that has something for you.' },
  { value: 'daily', label: 'Daily digest', hint: 'Everything from the past day in one morning email.' },
  { value: 'off', label: 'Off', hint: 'No alert emails.' },
]

// The lead times of the hearing reminders. The server accepts the same values
// (REMINDER_LEAD_HOURS in server/src/alerts.ts).
const REMINDER_OPTIONS: { hours: number; label: string }[] = [
  { hours: 48, label: '2 days before' },
  { hours: 24, label: '1 day before' },
  { hours: 2, label: '2 hours before' },
]

// Email alerts for the signed-in user: how they're delivered, and which of
// the workspace's tracked bills / subject watches / followed committees
// they come from. Every change saves immediately.
export function AlertSettings({ email }: { email: string }) {
  const [prefs, setPrefs] = useState<LoadState<NotificationPreferences>>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    client
      .getNotificationPreferences()
      .then((data) => setPrefs({ status: 'ready', data }))
      .catch(() => setPrefs({ status: 'empty' }))
  }, [])

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 2500)
    return () => clearTimeout(timer)
  }, [status])

  // Optimistic: the control reflects the click immediately, the server's
  // answer then replaces it, and a failure puts the previous state back.
  const save = async (
    optimistic: (p: NotificationPreferences) => NotificationPreferences,
    request: () => Promise<NotificationPreferences>,
  ) => {
    if (prefs.status !== 'ready') return
    const previous = prefs.data
    setPrefs({ status: 'ready', data: optimistic(previous) })
    setSaving(true)
    try {
      setPrefs({ status: 'ready', data: await request() })
      setStatus('Saved')
    } catch (err) {
      setPrefs({ status: 'ready', data: previous })
      setStatus(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (prefs.status === 'loading') return <div className="skeleton" style={{ height: 160, marginTop: 12 }} />
  if (prefs.status === 'empty') return <p className={styles.hint}>Alert settings couldn’t be loaded.</p>
  const { delivery, hearingReminderHours, trackedBills, subjectWatches, followedCommittees } = prefs.data
  const off = delivery === 'off'

  const toggle = (type: AlertSourceType, id: string | null, enabled: boolean) =>
    save(
      (p) => {
        const set = (sources: AlertSource[]) => sources.map((s) => (s.id === id ? { ...s, enabled } : s))
        if (type === 'tracked_bills') return { ...p, trackedBills: enabled }
        if (type === 'subject_watch') return { ...p, subjectWatches: set(p.subjectWatches) }
        return { ...p, followedCommittees: set(p.followedCommittees) }
      },
      () => client.setAlertSourceEnabled(type, id, enabled),
    )

  const sourceList = (type: AlertSourceType, sources: AlertSource[], empty: JSX.Element) =>
    sources.length === 0 ? (
      <p className={styles.hint}>{empty}</p>
    ) : (
      sources.map((s) => (
        <label key={s.id} className={styles.checkRow}>
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={off || saving}
            onChange={(e) => toggle(type, s.id, e.target.checked)}
          />
          {s.name}
        </label>
      ))
    )

  return (
    <div className={styles.wrap}>
      <p className={styles.hint}>
        Emails go to <b>{email}</b> when a bill changes status, gets amended, or has a hearing scheduled, and when a
        committee you follow schedules or moves a meeting.
      </p>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Send alerts</legend>
        {DELIVERY_OPTIONS.map((o) => (
          <label key={o.value} className={styles.radioRow}>
            <input
              type="radio"
              name="alert-delivery"
              value={o.value}
              checked={delivery === o.value}
              onChange={() =>
                save(
                  (p) => ({ ...p, delivery: o.value }),
                  () => client.setAlertDelivery(o.value),
                )
              }
            />
            <span>
              <span className={styles.optionLabel}>{o.label}</span>
              <span className={styles.optionHint}>{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={`${styles.fieldset} ${off ? styles.dimmed : ''}`}>
        <legend className={styles.legend}>Hearings</legend>
        <p className={styles.hint}>
          Hearing alerts go out right away, also when you choose the daily digest. They include a link to draft
          testimony.
        </p>
        <div className={styles.groupLabel} id="hearing-reminders-label">
          Remind me before a hearing
        </div>
        <div role="group" aria-labelledby="hearing-reminders-label">
          {REMINDER_OPTIONS.map((o) => (
            <label key={o.hours} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={hearingReminderHours.includes(o.hours)}
                disabled={off || saving}
                onChange={(e) => {
                  const enabled = e.target.checked
                  const hours = hearingReminderHours.filter((h) => h !== o.hours).concat(enabled ? [o.hours] : [])
                  save(
                    (p) => ({ ...p, hearingReminderHours: hours }),
                    () => client.setHearingReminderHours(hours),
                  )
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={`${styles.fieldset} ${off ? styles.dimmed : ''}`} aria-label="Alert sources">
        <legend className={styles.legend}>Alert me about</legend>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={trackedBills}
            disabled={off || saving}
            onChange={(e) => toggle('tracked_bills', null, e.target.checked)}
          />
          Tracked bills
        </label>

        <div className={styles.groupLabel}>Subject watches</div>
        {sourceList(
          'subject_watch',
          subjectWatches,
          <>
            No subject watches yet — <Link to="/watches">create one</Link>.
          </>,
        )}

        <div className={styles.groupLabel}>Followed committees</div>
        {sourceList(
          'followed_committee',
          followedCommittees,
          <>
            Not following any committees — <Link to="/committees">browse interim committees</Link>.
          </>,
        )}
      </fieldset>

      <div className={styles.status} role="status">
        {status}
      </div>
    </div>
  )
}
