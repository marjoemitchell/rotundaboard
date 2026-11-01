import { Link } from 'react-router-dom'
import type { Requester } from '../types'

// The name of a requester. A legislator or an interim committee links to its
// page. Set link to false to show only the name.
export function RequesterName({ requester, link = true }: { requester: Requester; link?: boolean }) {
  if (link && requester.legislatorId) return <Link to={`/legislators/${requester.legislatorId}`}>{requester.name}</Link>
  if (link && requester.committeeId) return <Link to={`/committees/${requester.committeeId}`}>{requester.name}</Link>
  return <>{requester.name}</>
}

// The names of a list of requesters, separated by commas.
export function RequesterList({ requesters, link = true }: { requesters: Requester[]; link?: boolean }) {
  return (
    <>
      {requesters.map((r, i) => (
        <span key={`${r.name}-${i}`}>
          {i > 0 && ', '}
          <RequesterName requester={r} link={link} />
        </span>
      ))}
    </>
  )
}
