import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DashboardData } from '../hooks/useDashboardData'
import * as client from '../data/client'
import { PageHeader } from '../components/PageHeader'
import { SessionClockStrip } from '../components/SessionClockStrip'
import { MovingNow } from '../components/MovingNow'
import { FilterBar } from '../components/FilterBar'
import { BillTable } from '../components/BillTable'
import { AIBrief } from '../components/rail/AIBrief'
import { HearingAudio, type ClipPayload } from '../components/rail/HearingAudio'
import { TeamBoard } from '../components/rail/TeamBoard'
import { FollowedCommittees } from '../components/rail/FollowedCommittees'
import { MomentumModel, MomentumModelToggle } from '../components/rail/MomentumModel'
import type { Bill, FilterState, LoadState } from '../types'
import { formatClock } from '../lib/format'
import styles from '../App.module.css'

function readMomentumPreference(): boolean {
  try {
    const stored = localStorage.getItem('rb.showMomentumModel')
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

export function DashboardPage({
  data,
  filteredBills,
  filters,
  identifierFilter,
  onSetFilter,
  onRemoveFilter,
  onSaveView,
  onSelectBill,
  setNotice,
}: {
  data: DashboardData
  filteredBills: LoadState<Bill[]>
  filters: FilterState
  identifierFilter: 'all' | 'lc' | 'introduced'
  onSetFilter: (key: keyof FilterState, value: string) => void
  onRemoveFilter: (key: keyof FilterState) => void
  onSaveView: () => void
  onSelectBill: (id: string) => void
  setNotice: (message: string) => void
}) {
  const navigate = useNavigate()
  const [showMomentumModel, setShowMomentumModelState] = useState(readMomentumPreference)

  const setShowMomentumModel = (value: boolean) => {
    setShowMomentumModelState(value)
    try {
      localStorage.setItem('rb.showMomentumModel', String(value))
    } catch {
      // ignore storage failures (private browsing, disabled storage)
    }
  }

  const handleClipToNotes = async (clip: ClipPayload) => {
    const hearing = data.hearings.status === 'ready' ? data.hearings.data.find((h) => h.id === clip.hearingId) : null
    const sourceHearing = hearing
      ? `${hearing.committee}, ${formatClock(clip.startSeconds)}–${formatClock(clip.endSeconds)}`
      : `Hearing clip, ${formatClock(clip.startSeconds)}–${formatClock(clip.endSeconds)}`
    try {
      await client.createNote({ body: clip.text, sourceHearing })
      setNotice(`Clipped ${formatClock(clip.startSeconds)}–${formatClock(clip.endSeconds)} to notes.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save this clip.')
    }
  }

  const activeFilterCount = Object.keys(filters).length
  const movingCount =
    data.bills.status === 'ready' ? data.bills.data.filter((b) => b.momentum.score >= 60).length : null
  const filteredCount = filteredBills.status === 'ready' ? filteredBills.data.length : null

  // LC Drafts / Introduced are quick filters on the same tracked-bill list,
  // not separate pages — the title/subhead switching is the only signal
  // that a filter is active, since the table below is otherwise the only
  // thing that visibly changes.
  const pageTitle =
    identifierFilter === 'lc' ? 'LC Drafts' : identifierFilter === 'introduced' ? 'Introduced Bills' : 'Dashboard'
  const pageSubhead =
    identifierFilter === 'lc'
      ? filteredCount === null
        ? 'Loading…'
        : `${filteredCount} LC draft${filteredCount === 1 ? '' : 's'} your team is tracking — bills that haven't been formally introduced yet.`
      : identifierFilter === 'introduced'
        ? filteredCount === null
          ? 'Loading…'
          : `${filteredCount} introduced bill${filteredCount === 1 ? '' : 's'} (HB/SB) your team is tracking.${activeFilterCount > 0 ? ` ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied.` : ''}`
        : movingCount === null
          ? 'Loading today’s activity…'
          : `${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — ${movingCount} bills moving this week${activeFilterCount > 0 ? `, ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : ''}.`

  return (
    <>
      <PageHeader
        title={pageTitle}
        subhead={pageSubhead}
        secondaryLabel="Export list"
        onSecondaryAction={() => setNotice('Export isn’t part of the dashboard home screen yet.')}
      />

      <SessionClockStrip calendar={data.sessionCalendar} />

      <div className={styles.content}>
        <div className={styles.primary}>
          <MovingNow bills={filteredBills} onSelectBill={onSelectBill} />
          <FilterBar
            bills={data.bills}
            teamMembers={data.teamMembers}
            filters={filters}
            onSetFilter={onSetFilter}
            onRemoveFilter={onRemoveFilter}
            onSaveView={onSaveView}
          />
          <BillTable
            bills={filteredBills}
            teamMembers={data.teamMembers}
            onSelectBill={onSelectBill}
            onViewAll={() => setNotice('The full tracked list isn’t part of the dashboard home screen yet.')}
          />
        </div>

        <div className={styles.rail}>
          <AIBrief brief={data.brief} bills={data.bills} onSelectBill={onSelectBill} />
          <HearingAudio
            hearings={data.hearings}
            onOpenTranscript={() => setNotice('Full transcript view isn’t part of the dashboard home screen yet.')}
            onClipToNotes={handleClipToNotes}
          />
          <TeamBoard
            teamBoard={data.teamBoard}
            teamMembers={data.teamMembers}
            onOpen={() => navigate('/tracking-board')}
            onSelectBill={onSelectBill}
          />
          <FollowedCommittees />
          {showMomentumModel ? (
            <MomentumModel factors={data.momentumFactors} onHide={() => setShowMomentumModel(false)} />
          ) : (
            <MomentumModelToggle onShow={() => setShowMomentumModel(true)} />
          )}
        </div>
      </div>
    </>
  )
}
