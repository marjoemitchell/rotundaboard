import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as client from '../data/client'
import { usePublicView } from '../lib/publicView'

// The router state that SignupGate gives to "+ Follow" for a visitor.
export function followAfterSignupState(committeeId: string) {
  return { followCommittee: committeeId }
}

// A visitor who clicked "+ Follow" and then signed up or logged in comes back
// with the committee id in the router state. Follow that committee, remove the
// state, and call `onFollowed`. Follow is safe to send two times.
export function useFollowAfterSignup(onFollowed: () => void) {
  const isPublic = usePublicView()
  const location = useLocation()
  const navigate = useNavigate()
  const committeeId = (location.state as { followCommittee?: string } | null)?.followCommittee

  useEffect(() => {
    if (isPublic || !committeeId) return
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    client
      .followCommittee(committeeId)
      .then(onFollowed)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublic, committeeId])
}
