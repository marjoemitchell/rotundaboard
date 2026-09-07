import { useCallback, useEffect, useRef, useState } from 'react'
import * as client from '../data/client'
import type {
  Bill,
  Brief,
  Hearing,
  LoadState,
  MomentumFactor,
  NavCounts,
  SavedView,
  SessionCalendar,
  TeamBoardSummary,
  TeamMember,
} from '../types'

function useResource<T>(
  fetcher: () => Promise<T>,
  isEmpty: (data: T) => boolean = () => false,
): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(() => {
    let cancelled = false
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    fetcherRef.current().then((data) => {
      if (cancelled) return
      setState(isEmpty(data) ? { status: 'empty' } : { status: 'ready', data })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => load(), [load])

  return [state, load]
}

export interface DashboardData {
  sessionCalendar: LoadState<SessionCalendar>
  bills: LoadState<Bill[]>
  brief: LoadState<Brief>
  hearings: LoadState<Hearing[]>
  teamBoard: LoadState<TeamBoardSummary>
  teamMembers: LoadState<TeamMember[]>
  momentumFactors: LoadState<MomentumFactor[]>
  savedViews: LoadState<SavedView[]>
  navCounts: LoadState<NavCounts>
  refetchBills: () => void
  refetchTeamBoard: () => void
  refetchSavedViews: () => void
}

export function useDashboardData(): DashboardData {
  const [sessionCalendar] = useResource(client.getSessionCalendar)
  const [bills, refetchBills] = useResource(client.getBills, (data) => data.length === 0)
  const [brief] = useResource(client.getBrief)
  const [hearings] = useResource(client.getHearings, (data) => data.length === 0)
  const [teamBoard, refetchTeamBoard] = useResource(client.getTeamBoard, (data) => data.activity.length === 0)
  const [teamMembers] = useResource(client.getWorkspaceMembers, (data) => data.length === 0)
  const [momentumFactors] = useResource(client.getMomentumFactors, (data) => data.length === 0)
  const [savedViews, refetchSavedViews] = useResource(client.getSavedViews, (data) => data.length === 0)
  const [navCounts] = useResource(client.getNavCounts)

  return {
    sessionCalendar,
    bills,
    brief,
    hearings,
    teamBoard,
    teamMembers,
    momentumFactors,
    savedViews,
    navCounts,
    refetchBills,
    refetchTeamBoard,
    refetchSavedViews,
  }
}
