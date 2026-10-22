import { useEffect, useMemo, useRef, useState } from 'react'
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
import { MomentumModel, MomentumModelToggle } from '../components/rail/MomentumModel'
import { SetupChecklist, SETUP_TRACK_TARGET, readSetupDismissed, storeSetupDismissed } from '../components/dashboard/SetupChecklist'
import { SuggestedDrafts } from '../components/dashboard/SuggestedDrafts'
import { ComingUp } from '../components/dashboard/ComingUp'
import type { Bill, FilterState, HearingSummary, LoadState, SuggestedBill } from '../types'
import { formatClock, plural } from '../lib/format'
import { isClosed } from '../lib/bills'
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
  onTrackBill,
  setNotice,
}: {
  data: DashboardData
  filteredBills: LoadState<Bill[]>
  filters: FilterState
  onSetFilter: (key: keyof FilterState, value: string) => void
  onRemoveFilter: (key: keyof FilterState) => void
  onSaveView: () => void
  onSelectBill: (id: string) => void
  /** Tracks a bill and reloads the dashboard data. Rejects when it fails. */
  onTrackBill: (billId: string) => Promise<void>
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

  // Active and closed bills. The table and "Moving now" use the filtered list.
  const split = useMemo(() => {
    const list = filteredBills.status === 'ready' ? filteredBills.data : []
    return { active: list.filter((b) => !isClosed(b)), closed: list.filter(isClosed) }
  }, [filteredBills])
  const activeBills: LoadState<Bill[]> =
    filteredBills.status !== 'ready'
      ? filteredBills
      : split.active.length === 0
        ? { status: 'empty' }
        : { status: 'ready', data: split.active }

  // Sparse mode: the team tracks fewer than SETUP_TRACK_TARGET active bills.
  // The check uses the unfiltered list: a filter that hides all bills shows
  // the table's "no matches" state, not the setup cards.
  const allTracked = data.bills.status === 'ready' ? data.bills.data : []
  const activeCount = allTracked.filter((b) => !isClosed(b)).length
  const hasAnyTracked = allTracked.length > 0
  const sparse = data.bills.status === 'empty' || (data.bills.status === 'ready' && activeCount < SETUP_TRACK_TARGET)
  const missingPositions = allTracked.filter((b) => !isClosed(b) && !b.position).length
  const watchCount = data.navCounts.status === 'ready' ? data.navCounts.data.subjectWatches : 0
  const memberCount = data.teamMembers.status === 'ready' ? data.teamMembers.data.length : 0

  // When all four setup steps are done, the card hides for good.
  const setupComplete = activeCount >= SETUP_TRACK_TARGET && watchCount > 0 && missingPositions === 0 && memberCount >= 2
  const [setupDismissed] = useState(readSetupDismissed)
  useEffect(() => {
    if (setupComplete) storeSetupDismissed()
  }, [setupComplete])
  const showSetup = !setupDismissed && !setupComplete

  const suggestionsRef = useRef<HTMLElement>(null)
  const handleTrackSuggestion = async (bill: SuggestedBill) => {
    try {
      await onTrackBill(bill.id)
      setNotice(`Tracking ${bill.identifier}.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `Could not track ${bill.identifier}.`)
      throw err
    }
  }

  // The dashboard plays only recordings of the committees that the team follows.
  const followedHearings: LoadState<HearingSummary[]> = useMemo(() => {
    if (data.hearings.status !== 'ready') return data.hearings
    const followed = data.hearings.data.filter((h) => h.isFollowed)
    return followed.length === 0 ? { status: 'empty' } : { status: 'ready', data: followed }
  }, [data.hearings])

  const movingCount = split.active.filter((b) => b.momentum.score >= 60).length
  const filtersApplied = activeFilterCount > 0 ? plural(activeFilterCount, 'filter') + ' applied' : ''
  // An "empty" bill list (no tracked bills) is not loading.
  const pageSubhead = data.billsFailed
    ? 'Your bills could not be loaded. Refresh the page to try again.'
    : data.bills.status === 'loading'
      ? 'Loading today’s activity…'
      : `${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${
          data.bills.status === 'empty'
            ? 'your team tracks no bills yet'
            : `${plural(movingCount, 'bill')} moving this week`
        }${filtersApplied ? `, ${filtersApplied}` : ''}.`

  const table = (
    <>
      <FilterBar
        bills={data.bills}
        teamMembers={data.teamMembers}
        filters={filters}
        onSetFilter={onSetFilter}
        onRemoveFilter={onRemoveFilter}
        onSaveView={onSaveView}
      />
      <BillTable
        bills={activeBills}
        closedBills={split.closed}
        teamMembers={data.teamMembers}
        onSelectBill={onSelectBill}
        onViewAll={() => setNotice('The full tracked list isn’t part of the dashboard home screen yet.')}
      />
    </>
  )

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
          {sparse ? (
            <>
              {showSetup && (
                <SetupChecklist
                  activeCount={activeCount}
                  watchCount={watchCount}
                  missingPositions={missingPositions}
                  memberCount={memberCount}
                  onFindBills={() => suggestionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  onShowMissingPositions={() => onSetFilter('position', 'none')}
                />
              )}
              <SuggestedDrafts ref={suggestionsRef} onTrack={handleTrackSuggestion} />
              <ComingUp upcoming={data.upcomingMeetings} />
              {hasAnyTracked && table}
            </>
          ) : (
            <>
              <MovingNow bills={activeBills} onSelectBill={onSelectBill} />
              {table}
              <ComingUp upcoming={data.upcomingMeetings} />
            </>
          )}
        </div>

        <div className={styles.rail}>
          <AIBrief brief={data.brief} bills={data.bills} onSelectBill={onSelectBill} onSendBrief={handleSendBrief} sending={sendingBrief} />
          <HearingAudio
            hearings={followedHearings}
            onOpenTranscript={(id) => navigate(`/hearings/recordings/${id}`)}
            onClipToNotes={handleClipToNotes}
          />
          <TeamBoard
            teamBoard={data.teamBoard}
            teamMembers={data.teamMembers}
            onOpen={() => navigate('/tracking-board')}
            onSelectBill={onSelectBill}
          />
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
