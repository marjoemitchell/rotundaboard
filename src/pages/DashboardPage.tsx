import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DashboardData } from '../hooks/useDashboardData'
import * as client from '../data/client'
import { PageHeader } from '../components/PageHeader'
import { DataFreshness } from '../components/DataFreshness'
import { SessionClockStrip } from '../components/SessionClockStrip'
import { MovingNow } from '../components/MovingNow'
import { FilterBar } from '../components/FilterBar'
import { BillTable } from '../components/BillTable'
import { AIBrief } from '../components/rail/AIBrief'
import { HearingAudio, type ClipPayload } from '../components/rail/HearingAudio'
import { TeamBoard } from '../components/rail/TeamBoard'
import { FollowedCommittees } from '../components/rail/FollowedCommittees'
import { MomentumModel, MomentumModelToggle } from '../components/rail/MomentumModel'
import type { Bill, FilterState, HearingSummary, LoadState } from '../types'
import { formatClock } from '../lib/format'
import { clipToNote } from '../lib/hearings'
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
  onSetFilter,
  onRemoveFilter,
  onSaveView,
  onSelectBill,
  setNotice,
}: {
  data: DashboardData
  filteredBills: LoadState<Bill[]>
  filters: FilterState
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

  const [sendingBrief, setSendingBrief] = useState(false)
  const handleSendBrief = async () => {
    setSendingBrief(true)
    try {
      await client.sendBrief()
      setNotice('Brief sent to your email.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not send the brief.')
    } finally {
      setSendingBrief(false)
    }
  }

  const handleClipToNotes = async (clip: ClipPayload, hearing: HearingSummary) => {
    try {
      await client.createNote(clipToNote(clip, hearing))
      setNotice(`Clipped ${formatClock(clip.startSeconds)}–${formatClock(clip.endSeconds)} to notes.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save this clip.')
    }
  }

  const activeFilterCount = Object.keys(filters).length
  const movingCount =
    data.bills.status === 'ready' ? data.bills.data.filter((b) => b.momentum.score >= 60).length : null
  const filtersApplied = activeFilterCount > 0 ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : ''
  // An "empty" bill list (no tracked bills) is not loading.
  const pageSubhead = data.billsFailed
    ? 'Your bills could not be loaded. Refresh the page to try again.'
    : data.bills.status === 'loading'
      ? 'Loading today’s activity…'
      : `${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${
          data.bills.status === 'empty' ? 'your team tracks no bills yet' : `${movingCount} bills moving this week`
        }${filtersApplied ? `, ${filtersApplied}` : ''}.`

  return (
    <>
      <PageHeader
        title="Dashboard"
        subhead={pageSubhead}
        secondaryLabel="Export list"
        onSecondaryAction={() => setNotice('Export isn’t part of the dashboard home screen yet.')}
        meta={<DataFreshness />}
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
          <AIBrief brief={data.brief} bills={data.bills} onSelectBill={onSelectBill} onSendBrief={handleSendBrief} sending={sendingBrief} />
          <HearingAudio
            hearings={data.hearings}
            onOpenTranscript={(id) => navigate(`/hearings/recordings/${id}`)}
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
