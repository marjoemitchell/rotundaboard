import { useCallback, useEffect, useRef, useState } from 'react'
import * as client from '../data/client'
import type {
  Bill,
  Brief,
  HearingSummary,
  LoadState,
  MomentumFactor,
  NavCounts,
  SavedView,
  SessionCalendar,
  TeamBoardSummary,
  TeamMember,
  UpcomingMeetings,
} from '../types'

// A failed request gives the state "empty" and failed = true, so that the
// page does not show "Loading" forever.
function useResource<T>(
  fetcher: () => Promise<T>,
  isEmpty: (data: T) => boolean = () => false,
): [LoadState<T>, () => void, boolean] {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [failed, setFailed] = useState(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(() => {
    let cancelled = false
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    fetcherRef.current().then(
      (data) => {
        if (cancelled) return
        setFailed(false)
        setState(isEmpty(data) ? { status: 'empty' } : { status: 'ready', data })
      },
      (err: unknown) => {
        if (cancelled) return
        console.error(err)
        setFailed(true)
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'empty' }))
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => load(), [load])

  return [state, load, failed]
}

export interface DashboardData {
  sessionCalendar: LoadState<SessionCalendar>
  bills: LoadState<Bill[]>
  /** True when the last request for the bills failed. */
  billsFailed: boolean
  brief: LoadState<Brief>
  hearings: LoadState<HearingSummary[]>
  teamBoard: LoadState<TeamBoardSummary>
  teamMembers: LoadState<TeamMember[]>
  momentumFactors: LoadState<MomentumFactor[]>
  savedViews: LoadState<SavedView[]>
  navCounts: LoadState<NavCounts>
  /** Meetings of the followed committees in the next 30 days. */
  upcomingMeetings: LoadState<UpcomingMeetings>
  refetchBills: () => void
  refetchTeamBoard: () => void
  refetchSavedViews: () => void
}

export function useDashboardData(): DashboardData {
  const [sessionCalendar] = useResource(client.getSessionCalendar)
  const [bills, refetchBills, billsFailed] = useResource(client.getBills, (data) => data.length === 0)
  const [brief] = useResource(client.getBrief)
  const [hearings] = useResource(client.getHearings, (data) => data.length === 0)
  const [teamBoard, refetchTeamBoard] = useResource(client.getTeamBoard, (data) => data.activity.length === 0)
  const [teamMembers] = useResource(client.getWorkspaceMembers, (data) => data.length === 0)
  const [momentumFactors] = useResource(client.getMomentumFactors, (data) => data.length === 0)
  const [savedViews, refetchSavedViews] = useResource(client.getSavedViews, (data) => data.length === 0)
  const [navCounts] = useResource(client.getNavCounts)
  const [upcomingMeetings] = useResource(client.getUpcomingMeetings)

  return {
    sessionCalendar,
    bills,
    billsFailed,
    brief,
    hearings,
    teamBoard,
    teamMembers,
    momentumFactors,
    savedViews,
    navCounts,
    upcomingMeetings,
    refetchBills,
    refetchTeamBoard,
    refetchSavedViews,
  }
}
