import { useEffect, useMemo, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useDashboardData } from './hooks/useDashboardData'
import { useFilterState } from './hooks/useFilterState'
import * as client from './data/client'
import { TopBar } from './components/TopBar'
import { LeftNav, type NavId } from './components/LeftNav'
import { CommandPalette } from './components/CommandPalette'
import { BillDetailDrawer } from './components/BillDetailDrawer'
import { Toast } from './components/shared/Toast'
import { usePrompt } from './hooks/usePrompt'
import { DashboardPage } from './pages/DashboardPage'
import { BillDetailPage } from './pages/BillDetailPage'
import { SessionsPage } from './pages/SessionsPage'
import { SessionBillsPage } from './pages/SessionBillsPage'
import { LegislatorsPage } from './pages/LegislatorsPage'
import { LegislatorDetailPage } from './pages/LegislatorDetailPage'
import { NotesPage } from './pages/NotesPage'
import { SubjectWatchesPage } from './pages/SubjectWatchesPage'
import { CommitteesPage } from './pages/CommitteesPage'
import { CommitteeDetailPage } from './pages/CommitteeDetailPage'
import { TrackingBoardPage } from './pages/TrackingBoardPage'
import { TestimonyPage } from './pages/TestimonyPage'
import { DigestsPage } from './pages/DigestsPage'
import { SettingsPage } from './pages/SettingsPage'
import { HearingsPage } from './pages/HearingsPage'
import type { Bill, FilterState, LoadState, Position } from './types'
import styles from './App.module.css'

const NAV_LABELS: Record<string, string> = {}

const RECOGNIZED_FILTER_KEYS = [
  'status',
  'subject',
  'position',
  'committee',
  'chamber',
  'sponsor',
  'party',
  'lastActionWithin',
  'assignee',
]

function parseSavedViewQuery(query: string): FilterState {
  const filters: FilterState = {}
  const pattern = /(\w+):("[^"]*"|\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(query))) {
    const rawKey = match[1]
    const rawValue = match[2].startsWith('"') ? match[2].slice(1, -1) : match[2]
    if (rawKey === 'momentum') {
      filters.momentumMin = rawValue.replace('>=', '')
    } else if (RECOGNIZED_FILTER_KEYS.includes(rawKey)) {
      ;(filters as Record<string, string>)[rawKey] = rawValue
    }
  }
  return filters
}

function applyFilters(bills: Bill[], filters: FilterState, identifierFilter: 'all' | 'lc' | 'introduced'): Bill[] {
  let list = bills
  if (identifierFilter === 'lc') list = list.filter((b) => b.identifier.startsWith('LC'))
  else if (identifierFilter === 'introduced') list = list.filter((b) => !b.identifier.startsWith('LC'))

  if (filters.status) list = list.filter((b) => b.status === filters.status)
  if (filters.subject) list = list.filter((b) => b.subjects.includes(filters.subject!))
  if (filters.position) list = list.filter((b) => b.position === filters.position)
  if (filters.momentumMin) list = list.filter((b) => b.momentum.score >= Number(filters.momentumMin))
  if (filters.committee) list = list.filter((b) => b.committee === filters.committee)
  if (filters.chamber) list = list.filter((b) => b.chamber === filters.chamber)
  if (filters.sponsor) list = list.filter((b) => b.sponsor.name === filters.sponsor)
  if (filters.party) list = list.filter((b) => b.sponsor.party === filters.party)
  if (filters.lastActionWithin) {
    const days = Number(filters.lastActionWithin)
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    list = list.filter((b) => new Date(b.lastAction.date).getTime() >= cutoff)
  }
  if (filters.assignee) list = list.filter((b) => b.assigneeId === filters.assignee)
  return list
}

export function AuthenticatedApp() {
  const data = useDashboardData()
  const { filters, setFilter, removeFilter, clearFilters } = useFilterState()
  const navigate = useNavigate()
  const location = useLocation()

  const [navActive, setNavActive] = useState<NavId>('all-bills')
  const [identifierFilter, setIdentifierFilter] = useState<'all' | 'lc' | 'introduced'>('all')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { prompt, promptDialog } = usePrompt()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  // navActive only updates when the nav itself is clicked (handleNavigate),
  // so it goes stale on direct navigation, a page refresh, or the browser
  // back/forward buttons. Routes with an unambiguous nav item override it
  // from the actual URL instead; "/" is intentionally left alone since its
  // highlighted item (all bills / LC drafts / introduced / a saved view)
  // depends on filter state handleNavigate already keeps in sync.
  const effectiveNavActive: NavId = location.pathname.startsWith('/sessions')
    ? 'sessions'
    : location.pathname.startsWith('/legislators')
      ? 'legislators'
      : location.pathname.startsWith('/notes')
        ? 'notes'
        : location.pathname.startsWith('/watches')
          ? 'watches'
          : location.pathname.startsWith('/committees')
            ? 'committees'
            : location.pathname.startsWith('/tracking-board')
              ? 'tracking-board'
              : location.pathname.startsWith('/testimony')
                ? 'testimony'
                : location.pathname.startsWith('/digests')
                  ? 'digests'
                  : location.pathname.startsWith('/hearings')
                    ? 'hearings'
                    : navActive

  const filteredBills = useMemo<LoadState<Bill[]>>(() => {
    if (data.bills.status !== 'ready') return data.bills
    return { status: 'ready', data: applyFilters(data.bills.data, filters, identifierFilter) }
  }, [data.bills, filters, identifierFilter])

  const selectedBill = data.bills.status === 'ready' ? data.bills.data.find((b) => b.id === selectedBillId) ?? null : null
  const selectedAssignee =
    selectedBill && data.teamMembers.status === 'ready'
      ? data.teamMembers.data.find((m) => m.id === selectedBill.assigneeId) ?? null
      : null

  const handleSelectBill = (id: string) => setSelectedBillId(id)

  const handleFilterByAssignee = (memberId: string) => {
    navigate('/')
    clearFilters()
    setFilter('assignee', memberId)
    setIdentifierFilter('all')
  }

  const handleViewFullDetails = (billId: string) => {
    setSelectedBillId(null)
    navigate(`/bills/${billId}`)
  }

  const handleNavigate = (id: NavId) => {
    setNavActive(id)
    setMobileNavOpen(false)

    if (id === 'all-bills') {
      navigate('/')
      setIdentifierFilter('all')
      return
    }
    if (id === 'lc-drafts') {
      navigate('/')
      setIdentifierFilter('lc')
      return
    }
    if (id === 'introduced') {
      navigate('/')
      setIdentifierFilter('introduced')
      return
    }
    if (id === 'hearings') {
      navigate('/hearings')
      return
    }
    if (id === 'sessions') {
      navigate('/sessions')
      return
    }
    if (id === 'legislators') {
      navigate('/legislators')
      return
    }
    if (id === 'notes') {
      navigate('/notes')
      return
    }
    if (id === 'watches') {
      navigate('/watches')
      return
    }
    if (id === 'committees') {
      navigate('/committees')
      return
    }
    if (id === 'tracking-board') {
      navigate('/tracking-board')
      return
    }
    if (id === 'testimony') {
      navigate('/testimony')
      return
    }
    if (id === 'digests') {
      navigate('/digests')
      return
    }
    if (id.startsWith('view:')) {
      const viewId = id.slice('view:'.length)
      const view = (data.savedViews.status === 'ready' ? data.savedViews.data : []).find((v) => v.id === viewId)
      if (view) {
        navigate('/')
        clearFilters()
        const parsed = parseSavedViewQuery(view.query)
        for (const [key, value] of Object.entries(parsed)) {
          if (value) setFilter(key as keyof FilterState, value)
        }
        setIdentifierFilter('all')
        setNotice(`Applied saved filter "${view.name}".`)
      }
      return
    }
    const label = NAV_LABELS[id]
    if (label) setNotice(`${label} isn't part of the dashboard home screen yet.`)
  }

  const handleSaveView = async () => {
    if (Object.keys(filters).length === 0) {
      setNotice('Add at least one filter before saving it.')
      return
    }
    const name = await prompt('Name this filter:', { placeholder: 'e.g. Coalition priority' })
    if (!name) return
    const query = Object.entries(filters)
      .map(([key, value]) => {
        if (key === 'momentumMin') return `momentum:>=${value}`
        return value && value.includes(' ') ? `${key}:"${value}"` : `${key}:${value}`
      })
      .join(' ')
    try {
      await client.createSavedView(name, '#5c6b80', query)
      data.refetchSavedViews()
      setNotice(`Saved filter "${name}".`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save this filter.')
    }
  }

  const handleDeleteSavedView = async (viewId: string) => {
    try {
      await client.deleteSavedView(viewId)
      data.refetchSavedViews()
      setNotice('Saved filter removed.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not remove this filter.')
    }
  }

  const handleChangePosition = async (billId: string, position: Position) => {
    try {
      await client.setBillPosition(billId, position)
      data.refetchBills()
      data.refetchTeamBoard()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update position.')
    }
  }

  const handleChangeAssignee = async (billId: string, assigneeId: string | null) => {
    try {
      await client.setBillAssignee(billId, assigneeId)
      data.refetchBills()
      data.refetchTeamBoard()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update assignee.')
    }
  }

  const handleTrackBill = async (billId: string) => {
    try {
      await client.trackBill(billId)
      data.refetchBills()
      data.refetchTeamBoard()
      setNotice('Added to tracked bills.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not track this bill.')
    }
  }

  const handleUntrackBill = async (billId: string) => {
    try {
      await client.untrackBill(billId)
      data.refetchBills()
      data.refetchTeamBoard()
      setNotice('Removed from tracked bills.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not untrack this bill.')
    }
  }

  return (
    <>
      {promptDialog}
      {mobileNavOpen && <div className={styles.navScrim} onClick={() => setMobileNavOpen(false)} />}
      <TopBar
        teamMembers={data.teamMembers}
        onOpenPalette={() => setPaletteOpen(true)}
        onFilterByAssignee={handleFilterByAssignee}
      />
      <div className={styles.shell}>
        <LeftNav
          activeId={effectiveNavActive}
          navCounts={data.navCounts}
          savedViews={data.savedViews}
          isOpen={mobileNavOpen}
          onNavigate={handleNavigate}
          onDeleteView={handleDeleteSavedView}
        />
        <main className={styles.main}>
          <button className={styles.menuButton} onClick={() => setMobileNavOpen((o) => !o)}>
            ☰ Menu
          </button>

          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage
                  data={data}
                  filteredBills={filteredBills}
                  filters={filters}
                  identifierFilter={identifierFilter}
                  onSetFilter={setFilter}
                  onRemoveFilter={removeFilter}
                  onSaveView={handleSaveView}
                  onSelectBill={handleSelectBill}
                  setNotice={setNotice}
                />
              }
            />
            <Route
              path="/bills/:id"
              element={
                <BillDetailPage
                  teamMembers={data.teamMembers}
                  onChangePosition={handleChangePosition}
                  onChangeAssignee={handleChangeAssignee}
                  onTrackBill={handleTrackBill}
                  onUntrackBill={handleUntrackBill}
                />
              }
            />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:sessionId" element={<SessionBillsPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/watches" element={<SubjectWatchesPage />} />
            <Route path="/committees" element={<CommitteesPage />} />
            <Route path="/committees/:id" element={<CommitteeDetailPage />} />
            <Route
              path="/tracking-board"
              element={
                <TrackingBoardPage
                  bills={data.bills}
                  teamMembers={data.teamMembers}
                  onSelectBill={handleSelectBill}
                  onChangePosition={handleChangePosition}
                  onChangeAssignee={handleChangeAssignee}
                />
              }
            />
            <Route path="/testimony" element={<TestimonyPage />} />
            <Route path="/digests" element={<DigestsPage />} />
            <Route path="/legislators" element={<LegislatorsPage />} />
            <Route path="/legislators/:id" element={<LegislatorDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/hearings" element={<HearingsPage />} />
          </Routes>
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          bills={data.bills}
          onClose={() => setPaletteOpen(false)}
          onSelectBill={handleSelectBill}
          onNavigate={handleNavigate}
        />
      )}

      {selectedBill && (
        <BillDetailDrawer
          bill={selectedBill}
          assignee={selectedAssignee}
          teamMembers={data.teamMembers}
          onClose={() => setSelectedBillId(null)}
          onChangePosition={(position) => handleChangePosition(selectedBill.id, position)}
          onChangeAssignee={(assigneeId) => handleChangeAssignee(selectedBill.id, assigneeId)}
          onViewFullDetails={() => handleViewFullDetails(selectedBill.id)}
        />
      )}

      {notice && <Toast message={notice} />}
    </>
  )
}
