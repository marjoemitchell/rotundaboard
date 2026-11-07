import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { geoConicConformal, geoPath } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import * as client from '../data/client'
import type { LegislatorMap, LoadState, MapCounty, MapMember } from '../types'
import { EmptyState } from '../components/shared/EmptyState'
import { LegislatorsViewSwitch } from '../components/legislators/LegislatorsViewSwitch'
import { plural } from '../lib/format'
import { usePublicView } from '../lib/publicView'
import styles from './LegislatorsMapPage.module.css'

type Chamber = 'both' | 'house' | 'senate'
type Shape = Feature<Geometry, { name: string }>

const W = 900
const H = 520
// Fill by the number of members in the county who sponsor a tracked bill: 0, 1, 2, 3+.
const SHADES = ['var(--soft)', '#c9d6e3', '#9fb5cb', '#6f8fb0']
const PARTY_COLORS: Record<string, string> = { R: 'var(--oppose-fg)', D: 'var(--support-fg)' }
// A county with a smaller area (in square pixels) gets no label: the name does not fit.
const LABEL_MIN_AREA = 900

const CHAMBERS: { id: Chamber; label: string }[] = [
  { id: 'both', label: 'Both chambers' },
  { id: 'house', label: 'House' },
  { id: 'senate', label: 'Senate' },
]

function membersOf(county: MapCounty, byDistrict: Map<string, MapMember>, chamber: Chamber) {
  const pick = (c: 'house' | 'senate', districts: number[]) =>
    districts.map((d) => byDistrict.get(`${c}:${d}`)).filter((m): m is MapMember => Boolean(m))
  return {
    senate: chamber === 'house' ? [] : pick('senate', county.senate),
    house: chamber === 'senate' ? [] : pick('house', county.house),
  }
}

/** A CSV file of the members, for a download. */
function contactsCsv(members: MapMember[]): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = members.map((m) =>
    [m.name, m.chamber === 'house' ? 'House' : 'Senate', String(m.district), m.party ?? '', m.email ?? '', m.committees.join('; ')]
      .map(cell)
      .join(','),
  )
  return ['Name,Chamber,District,Party,Email,Committees', ...rows].join('\r\n')
}

// The landing view of the legislators: a county map of Montana. Hover a
// county to see who represents it, click to pin it. The list with search
// is at /legislators/list.
export function LegislatorsMapPage() {
  const [data, setData] = useState<LoadState<LegislatorMap>>({ status: 'loading' })
  const [shapes, setShapes] = useState<Shape[] | null>(null)
  const [state, setState] = useState<Shape | null>(null)
  const [shapesFailed, setShapesFailed] = useState(false)
  const [chamber, setChamber] = useState<Chamber>('both')
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // ?district=senate-9 (a link from a legislator page): the counties of that
  // district are outlined, and the county with the largest part is pinned.
  const [search, setSearch] = useSearchParams()
  const districtParam = /^(house|senate)-(\d{1,3})$/.exec(search.get('district') ?? '')
  const district = districtParam ? { chamber: districtParam[1] as 'house' | 'senate', number: Number(districtParam[2]) } : null
  // A visitor tracks no bills, so the map shows no tracked counts.
  const isPublic = usePublicView()

  useEffect(() => {
    ;(isPublic ? client.getPublicLegislatorMap() : client.getLegislatorMap())
      .then((d) => setData(d.counties.length === 0 ? { status: 'empty' } : { status: 'ready', data: d }))
      .catch(() => setData({ status: 'empty' }))
    fetch('/maps/montana-counties.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((fc: FeatureCollection<Geometry, { name: string }>) => {
        setShapes(fc.features.filter((f) => f.id !== 'state') as Shape[])
        setState((fc.features.find((f) => f.id === 'state') as Shape) ?? null)
      })
      .catch(() => setShapesFailed(true))
  }, [isPublic])

  const path = useMemo(() => {
    if (!state) return null
    const projection = geoConicConformal()
      .parallels([45, 49])
      .rotate([109.5, 0])
      .fitExtent(
        [
          [16, 16],
          [W - 16, H - 16],
        ],
        state,
      )
    return geoPath(projection)
  }, [state])

  const map = data.status === 'ready' ? data.data : null
  const byDistrict = useMemo(
    () => new Map((map?.members ?? []).map((m): [string, MapMember] => [`${m.chamber}:${m.district}`, m])),
    [map],
  )
  const countyByFips = useMemo(() => new Map((map?.counties ?? []).map((c): [string, MapCounty] => [c.fips, c])), [map])

  const sponsorsIn = (county: MapCounty) => {
    const { senate, house } = membersOf(county, byDistrict, chamber)
    return [...senate, ...house].filter((m) => m.trackedSponsored > 0).length
  }

  // The counties of the district in the URL, the county with the largest part first.
  const districtFips = useMemo(
    () => (district && map ? (map.districts[district.chamber][String(district.number)] ?? []) : []),
    [map, district?.chamber, district?.number],
  )
  const districtMember = district ? byDistrict.get(`${district.chamber}:${district.number}`) ?? null : null
  // When the map data arrives: the district's chamber, and a county pinned:
  // the member's home county when it is in the district, else the county
  // with the largest part of the district.
  const appliedDistrict = useRef<string | null>(null)
  useEffect(() => {
    const key = district ? `${district.chamber}-${district.number}` : null
    if (!key || !map || appliedDistrict.current === key || districtFips.length === 0) return
    appliedDistrict.current = key
    setChamber(district!.chamber)
    const home = districtMember?.homeCounty
      ? districtFips.find((f) => countyByFips.get(f)?.name === districtMember.homeCounty)
      : undefined
    setPinned(home ?? districtFips[0])
  }, [map, district, districtFips, districtMember, countyByFips])
  const clearDistrict = () => {
    const next = new URLSearchParams(search)
    next.delete('district')
    setSearch(next, { replace: true })
    appliedDistrict.current = null
  }

  const selectedFips = pinned ?? hovered
  const selected = selectedFips ? countyByFips.get(selectedFips) ?? null : null

  const onMove = (e: React.MouseEvent, fips: string) => {
    if (hovered !== fips) setHovered(fips)
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) return
    let x = e.clientX - box.left + 14
    if (x + 180 > box.width) x -= 200
    setTip({ x, y: e.clientY - box.top + 14 })
  }

  const loading = data.status === 'loading' || (!shapes && !shapesFailed)

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Legislators by county</h1>
          <p className={styles.subhead}>Hover a county to see who represents it. Click to pin it.</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.seg} role="group" aria-label="Chamber">
            {CHAMBERS.map((c) => (
              <button key={c.id} className={chamber === c.id ? styles.on : undefined} aria-pressed={chamber === c.id} onClick={() => setChamber(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <LegislatorsViewSwitch current="map" />
        </div>
      </div>

      {map && (
        <AddressLookup
          byDistrict={byDistrict}
          onFound={(house) => {
            const next = new URLSearchParams(search)
            next.set('district', `house-${house}`)
            setSearch(next, { replace: true })
          }}
        />
      )}

      {data.status === 'empty' && <EmptyState message="The legislator data could not be loaded." />}

      {data.status !== 'empty' && (
        <div className={styles.grid}>
          <section className={styles.mapCard} aria-label="Montana county map">
            <div className={styles.mapBar}>
              <span className="eyebrow">Montana · 56 counties</span>
              <div className={styles.legend} aria-label="Legend">
                {!isPublic &&
                  ['None', '1', '2', '3+'].map((label, i) => (
                  <span key={label}>
                    <i style={{ background: SHADES[i] }} />
                    {label}
                  </span>
                ))}
                <span>
                  <i style={{ background: 'var(--accent)' }} />
                  Selected
                </span>
              </div>
            </div>

            {/* Touch screens have no hover, and the map is hard to use with a
                keyboard, so the counties are also in a menu. */}
            {map && (
              <label className={styles.countyPicker}>
                <span>County</span>
                <select aria-label="County" value={pinned ?? ''} onChange={(e) => setPinned(e.target.value || null)}>
                  <option value="">Choose a county</option>
                  {map.counties.map((c) => (
                    <option key={c.fips} value={c.fips}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className={styles.mapWrap} ref={wrapRef}>
              {loading && <div className={styles.loading}>Loading the county map…</div>}
              {shapesFailed && <div className={styles.loading}>The county map could not be loaded. Reload the page to try again.</div>}
              {shapes && path && map && (
                <svg className={styles.map} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of the Montana counties">
                  <g>
                    {/* The district's counties last, so that no other county border covers their outline. */}
                    {[...shapes.filter((s) => !districtFips.includes(String(s.id))), ...shapes.filter((s) => districtFips.includes(String(s.id)))].map((s) => {
                      const fips = String(s.id)
                      const county = countyByFips.get(fips)
                      const fill = county ? SHADES[Math.min(3, sponsorsIn(county))] : SHADES[0]
                      const isSelected = fips === pinned || (fips === hovered && !pinned)
                      return (
                        <path
                          key={fips}
                          d={path(s) ?? undefined}
                          className={`${styles.county} ${fips === hovered ? styles.hover : ''} ${fips === pinned ? styles.pinned : ''} ${
                            districtFips.includes(fips) ? styles.inDistrict : ''
                          }`}
                          data-in-district={districtFips.includes(fips) || undefined}
                          style={{ fill: isSelected || fips === hovered ? 'var(--accent)' : fill }}
                          data-county={s.properties.name}
                          onMouseMove={(e) => onMove(e, fips)}
                          onMouseLeave={() => {
                            setHovered(null)
                            setTip(null)
                          }}
                          onClick={() => setPinned((p) => (p === fips ? null : fips))}
                        />
                      )
                    })}
                  </g>
                  {state && <path className={styles.state} d={path(state) ?? undefined} />}
                  <g>
                    {shapes
                      .filter((s) => path.area(s) > LABEL_MIN_AREA)
                      .map((s) => {
                        const [x, y] = path.centroid(s)
                        return (
                          <text key={String(s.id)} className={styles.label} x={x} y={y} dy="0.35em">
                            {s.properties.name.toUpperCase()}
                          </text>
                        )
                      })}
                  </g>
                </svg>
              )}
              {tip && hovered && countyByFips.get(hovered) && (
                <div className={styles.tip} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
                  {countyByFips.get(hovered)!.name}
                  <span>
                    {plural(
                      (() => {
                        const m = membersOf(countyByFips.get(hovered)!, byDistrict, chamber)
                        return m.senate.length + m.house.length
                      })(),
                      'member',
                    )}
                  </span>
                </div>
              )}
            </div>
            <div className={styles.mapFoot}>
              {!isPublic && <span>Shading: members in the county who sponsor a bill that your team tracks</span>}
              <span>
                Districts: US Census 2024 boundaries. Address search: US Census Geocoder. Address suggestions: Photon,{' '}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                  © OpenStreetMap contributors
                </a>
              </span>
            </div>
          </section>

          <aside className={styles.panel} aria-label="County details">
            {selected ? (
              <>
                {district && districtFips.length > 0 && (
                  <DistrictNote
                    label={`${district.chamber === 'house' ? 'House' : 'Senate'} District ${district.number}`}
                    member={districtMember}
                    counties={districtFips.map((f) => countyByFips.get(f)).filter((c): c is MapCounty => Boolean(c))}
                    pinned={pinned}
                    onPin={setPinned}
                    onClear={clearDistrict}
                  />
                )}
                <CountyPanel
                  county={selected}
                  members={membersOf(selected, byDistrict, chamber)}
                  pinned={pinned != null}
                  highlight={districtMember?.id ?? null}
                  onUnpin={() => setPinned(null)}
                />
              </>
            ) : (
              <div className={styles.empty}>
                <div className="eyebrow">No county selected</div>
                <p>
                  Hover any county, or choose one in the menu, to see its House and Senate members
                  {isPublic ? ' and their committees.' : ', their committees, and which tracked bills they sponsor.'}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

// The address search (issue #69). It finds the House and Senate districts of a
// street address and shows the member of each district.
//
// While the person types, the field shows address suggestions from Photon
// (OpenStreetMap). The arrow keys move through the suggestions, and Enter
// chooses one. When no suggestion is highlighted, Enter starts the search.
// A suggestion with a house number starts the search immediately.
const SUGGEST_DELAY_MS = 250
const SUGGEST_MIN_LENGTH = 3

function AddressLookup({ byDistrict, onFound }: { byDistrict: Map<string, MapMember>; onFound: (house: number) => void }) {
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<client.DistrictLookupResult | null>(null)
  const [suggestions, setSuggestions] = useState<client.AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // True only after the person types. A chosen suggestion does not get new suggestions.
  const typed = useRef(false)

  useEffect(() => {
    if (!typed.current) return
    const text = address.trim()
    if (text.length < SUGGEST_MIN_LENGTH) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const result = await client.suggestAddresses(text, controller.signal)
      // A search or a chosen suggestion after the request stops the suggestions.
      if (controller.signal.aborted || !typed.current) return
      setSuggestions(result)
      setActive(-1)
      setOpen(result.length > 0)
    }, SUGGEST_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [address])

  const runLookup = async (text: string) => {
    if (!text.trim() || busy) return
    setOpen(false)
    typed.current = false
    setBusy(true)
    const result = await client.lookupLegislatorDistricts(text.trim())
    setBusy(false)
    setOutcome(result)
    if (result.status === 'found') onFound(result.result.house)
  }

  const choose = (s: client.AddressSuggestion) => {
    typed.current = false
    setAddress(s.label)
    setOpen(false)
    setActive(-1)
    if (s.hasHouseNumber) void runLookup(s.label)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void runLookup(address)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && open && active >= 0) {
      // Choose the highlighted suggestion. Do not send the form.
      e.preventDefault()
      choose(suggestions[active])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  const card = (chamber: 'house' | 'senate', district: number) => {
    const member = byDistrict.get(`${chamber}:${district}`)
    const label = `${chamber === 'house' ? 'House' : 'Senate'} District ${district}`
    return (
      <li className={styles.lookupMember} aria-label={label}>
        <span className="eyebrow">{label}</span>
        {member ? (
          <>
            <Link to={`/legislators/${member.id}`} className={styles.memberName}>
              {chamber === 'house' ? 'Rep.' : 'Sen.'} {member.name}
            </Link>
            <div className={styles.memberMeta}>
              {[member.party, member.homeCounty && `${member.homeCounty} County`].filter(Boolean).join(' · ')}
            </div>
            {member.email && (
              <a className={styles.lookupEmail} href={`mailto:${member.email}`}>
                {member.email}
              </a>
            )}
          </>
        ) : (
          <div className={styles.memberMeta}>No current member in our data for this district.</div>
        )}
      </li>
    )
  }

  return (
    <section className={styles.lookup}>
      <form className={styles.lookupForm} onSubmit={submit} role="search" aria-label="Address search">
        <label className={styles.lookupLabel} htmlFor="legislator-address">
          Find my legislators
        </label>
        <div className={styles.lookupRow}>
          <div className={styles.lookupCombo}>
            <input
              id="legislator-address"
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls="legislator-address-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={open && active >= 0 ? `legislator-address-suggestion-${active}` : undefined}
              // The suggestions replace the address autofill of the browser.
              autoComplete="off"
              placeholder="Street address, for example 1301 E 6th Ave, Helena, MT"
              value={address}
              onChange={(e) => {
                typed.current = true
                setAddress(e.target.value)
              }}
              onKeyDown={onKeyDown}
              onBlur={() => setOpen(false)}
              maxLength={200}
            />
            {open && (
              <ul id="legislator-address-suggestions" role="listbox" aria-label="Address suggestions" className={styles.lookupSuggestions}>
                {suggestions.map((s, i) => (
                  <li
                    key={s.label}
                    id={`legislator-address-suggestion-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? styles.lookupSuggestionActive : undefined}
                    // mousedown comes before the blur of the field, so the list is still open.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(s)
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    {s.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" disabled={busy || !address.trim()}>
            {busy ? 'Searching…' : 'Find'}
          </button>
        </div>
      </form>

      {outcome?.status === 'found' && (
        <div className={styles.lookupResult} aria-label="Your legislators" role="region">
          <div className={styles.lookupMatched}>
            Results for <b>{outcome.result.matchedAddress}</b>
          </div>
          <ul className={styles.lookupMembers}>
            {card('house', outcome.result.house)}
            {card('senate', outcome.result.senate)}
          </ul>
        </div>
      )}
      {outcome && outcome.status !== 'found' && (
        <p className={styles.lookupError} role="alert">
          {outcome.status === 'no-match'
            ? 'No Montana address matches. Type a street address, not a PO box, or choose your county on the map.'
            : outcome.message}
        </p>
      )}
      <p className={styles.lookupNote}>While you type, the address goes to Photon for suggestions. The search sends it to the US Census Geocoder to find the districts. Rotunda Board does not keep it.</p>
    </section>
  )
}

// The district from a legislator page link: its member and its counties.
function DistrictNote({
  label,
  member,
  counties,
  pinned,
  onPin,
  onClear,
}: {
  label: string
  member: MapMember | null
  counties: MapCounty[]
  pinned: string | null
  onPin: (fips: string) => void
  onClear: () => void
}) {
  return (
    <div className={styles.districtNote} aria-label="District">
      <div className={styles.panelHeadRow}>
        <span className="eyebrow">{label}</span>
        <button className={styles.unpin} onClick={onClear}>
          Clear ×
        </button>
      </div>
      {member && (
        <div className={styles.districtMember}>
          {member.chamber === 'house' ? 'Rep.' : 'Sen.'} {member.name}
          {member.homeCounty && <span className={styles.districtHome}> · lives in {member.homeCounty} County</span>}
        </div>
      )}
      <div className={styles.districtCounties}>
        {counties.length === 1 ? 'In ' : `Covers parts of ${counties.length} counties: `}
        {counties.map((c, i) => (
          <span key={c.fips}>
            {i > 0 && ', '}
            <button className={styles.countyLink} aria-pressed={pinned === c.fips} onClick={() => onPin(c.fips)}>
              {c.name}
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

function CountyPanel({
  county,
  members,
  pinned,
  highlight,
  onUnpin,
}: {
  county: MapCounty
  members: { senate: MapMember[]; house: MapMember[] }
  pinned: boolean
  /** The member to mark: the member of the district from the URL. */
  highlight: string | null
  onUnpin: () => void
}) {
  const all = [...members.senate, ...members.house]
  const r = all.filter((m) => m.party === 'R').length
  const d = all.filter((m) => m.party === 'D').length
  const sponsors = all.filter((m) => m.trackedSponsored > 0).length
  const isPublic = usePublicView()
  const emails = all.map((m) => m.email).filter((e): e is string => Boolean(e))

  const exportContacts = () => {
    const blob = new Blob([contactsCsv(all)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${county.name.replace(/\W+/g, '-').toLowerCase()}-county-legislators.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rows = (list: MapMember[], label: string) =>
    list.length > 0 && (
      <div className={styles.section}>
        <div className="eyebrow">{label}</div>
        <ul className={styles.members} aria-label={`${label} members`}>
          {list.map((m) => (
            <li key={m.id} className={`${styles.member} ${m.id === highlight ? styles.memberHighlight : ''}`} aria-current={m.id === highlight || undefined}>
              <span className={styles.avatar} style={{ background: PARTY_COLORS[m.party ?? ''] ?? 'var(--muted)' }} aria-hidden="true">
                {m.initials}
              </span>
              <div className={styles.memberMain}>
                <Link to={`/legislators/${m.id}`} className={styles.memberName}>
                  {m.chamber === 'house' ? 'Rep.' : 'Sen.'} {m.name}
                </Link>
                <div className={styles.memberMeta}>
                  {[`${m.chamber === 'house' ? 'HD' : 'SD'} ${m.district}`, m.party, m.committees[0]].filter(Boolean).join(' · ')}
                </div>
              </div>
              {!isPublic && (
                <div className={styles.memberCount}>
                  {m.trackedSponsored > 0 ? (
                    <>
                      <b>{m.trackedSponsored}</b>
                      <span>tracked</span>
                    </>
                  ) : (
                    <span aria-label="Sponsors no tracked bill">—</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    )

  return (
    <>
      <div className={styles.panelHead}>
        <div className={styles.panelHeadRow}>
          <span className="eyebrow">{pinned ? 'Pinned county' : 'County'}</span>
          {pinned ? (
            <button className={styles.unpin} onClick={onUnpin}>
              Unpin ×
            </button>
          ) : (
            <span className="eyebrow">Click to pin</span>
          )}
        </div>
        <h2 className={styles.countyName}>{county.name} County</h2>
        <div className={styles.countyMeta}>
          {plural(county.house.length, 'House district')} · {plural(county.senate.length, 'Senate district')}
        </div>
      </div>
      <div className={`${styles.stats} ${isPublic ? styles.statsTwo : ''}`}>
        <div>
          <b>{all.length}</b>
          <span>Members</span>
        </div>
        <div>
          <b>
            {r} to {d}
          </b>
          <span>R to D</span>
        </div>
        {!isPublic && (
          <div>
            <b>{sponsors}</b>
            <span>Sponsor tracked</span>
          </div>
        )}
      </div>
      {rows(members.senate, 'Senate')}
      {rows(members.house, 'House')}
      <div className={styles.panelFoot}>
        {emails.length > 0 && (
          <a className={`${styles.button} ${styles.primary}`} href={`mailto:?bcc=${encodeURIComponent(emails.join(','))}`}>
            Email the delegation
          </a>
        )}
        <button className={styles.button} onClick={exportContacts}>
          Export contacts
        </button>
      </div>
    </>
  )
}
