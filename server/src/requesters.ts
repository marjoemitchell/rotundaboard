// The requester of an LC draft is a legislator, a committee, or an
// organization (an agency or another group). A "by request of" entry of a
// draft uses the same types. drafts.requester_type tells which table has the
// requester.

export interface Requester {
  name: string
  /** The id of the legislator, when the requester is a legislator. */
  legislatorId: string | null
  /** The id of the interim committee, when the requester is an interim committee. */
  committeeId: string | null
}

// A SQL expression for the name of a requester. The arguments are SQL
// expressions for the requester type and the requester id. The result is
// null when the type is not known or the row is not in the database.
export function requesterNameSql(type: string, id: string): string {
  return `(CASE
    WHEN ${type} = 'LEGISLATOR' THEN (SELECT nullif(trim(coalesce(rl.first_name, '') || ' ' || coalesce(rl.last_name, '')), '') FROM legislators rl WHERE rl.id = ${id})
    WHEN ${type} = 'STANDING_COMMITTEE' THEN (SELECT rsc.name FROM standing_committees rsc WHERE rsc.id = ${id})
    WHEN ${type} = 'NON_STANDING_COMMITTEE' THEN (SELECT rnc.name FROM non_standing_committees rnc WHERE rnc.id = ${id})
    WHEN ${type} IN ('AGENCY', 'ORGANIZATION') OR ${type} LIKE 'AGENCY\\_%' THEN (SELECT ro.name FROM organizations ro WHERE ro.id = ${id})
  END)`
}

// A SQL expression for the "by request of" entries of a draft, as a JSON
// array of { type, id, name }. The argument is a SQL expression for the draft id.
export function byRequestOfsSql(draftId: string): string {
  return `(SELECT coalesce(json_agg(json_build_object(
      'type', bro.request_type, 'id', bro.request_of_id,
      'name', ${requesterNameSql('bro.request_type', 'bro.request_of_id')}) ORDER BY bro.id), '[]'::json)
    FROM draft_by_request_ofs bro WHERE bro.draft_id = ${draftId})`
}

export function toRequester(type: string | null, id: number | null, name: string | null): Requester | null {
  if (!name) return null
  return {
    name,
    legislatorId: type === 'LEGISLATOR' && id != null ? String(id) : null,
    committeeId: type === 'NON_STANDING_COMMITTEE' && id != null ? String(id) : null,
  }
}
