// Builds the county data for the legislators map. Run it again after Montana
// redistricts. It is a one-time build script, not part of the app.
//
// Inputs (put them in one folder, <dir>):
//   raw/counties-10m.json       https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json
//   unz/tl_2024_30_sldl/*.shp   https://www2.census.gov/geo/tiger/TIGER2024/SLDL/tl_2024_30_sldl.zip
//   unz/tl_2024_30_sldu/*.shp   https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_30_sldu.zip
//
// Run:
//   npm i --no-save shapefile@0.6 @turf/turf@7 topojson-client@3
//   node scripts/buildCountyDistricts.mjs <dir>
//
// Outputs:
//   src/data/montanaCountyDistricts.json   the House and Senate districts in each county, and
//                                           the counties of each district (largest part first)
//   ../public/maps/montana-counties.json   the county shapes and the state outline (GeoJSON)
//
// A district is in a county when the county has 2% or more of the district's
// area, or the district has 5% or more of the county's area. The county
// lines are generalized (1:10m), so smaller overlaps are slivers along the
// county lines, not real overlaps.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as shapefile from 'shapefile'
import * as turf from '@turf/turf'
import { feature, merge } from 'topojson-client'

const DISTRICT_SHARE = 0.02
const COUNTY_SHARE = 0.05
const dir = process.argv[2]
if (!dir) throw new Error('usage: node scripts/buildCountyDistricts.mjs <dir>')
const here = path.dirname(fileURLToPath(import.meta.url))

const us = JSON.parse(readFileSync(path.join(dir, 'raw/counties-10m.json'), 'utf8'))
const isMontana = (g) => String(g.id).startsWith('30')
const counties = feature(us, us.objects.counties).features.filter(isMontana)

async function districts(name, field) {
  const base = path.join(dir, 'unz', name, name)
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`)
  const out = []
  for (let r = await src.read(); !r.done; r = await src.read()) {
    out.push({ number: Number(r.value.properties[field]), geom: r.value })
  }
  return out
}

const result = counties.map((c) => ({ fips: String(c.id), name: c.properties.name, house: [], senate: [] }))
const byFips = new Map(result.map((r) => [r.fips, r]))
// The counties of each district, with the share of the district's area.
const districtCounties = { house: {}, senate: {} }
for (const [chamber, list] of [
  ['house', await districts('tl_2024_30_sldl', 'SLDLST')],
  ['senate', await districts('tl_2024_30_sldu', 'SLDUST')],
]) {
  for (const d of list) {
    const districtArea = turf.area(d.geom)
    const box = turf.bboxPolygon(turf.bbox(d.geom))
    for (const c of counties) {
      if (!turf.booleanIntersects(box, turf.bboxPolygon(turf.bbox(c)))) continue
      const overlap = turf.intersect(turf.featureCollection([d.geom, c]))
      if (!overlap) continue
      const a = turf.area(overlap)
      if (a / districtArea >= DISTRICT_SHARE || a / turf.area(c) >= COUNTY_SHARE) {
        byFips.get(String(c.id))[chamber].push(d.number)
        ;(districtCounties[chamber][d.number] ??= []).push({ fips: String(c.id), share: a / districtArea })
      }
    }
  }
}
for (const r of result) {
  r.house.sort((a, b) => a - b)
  r.senate.sort((a, b) => a - b)
}
result.sort((a, b) => a.name.localeCompare(b.name))
// For each district: its counties, the county with the largest part first.
const countiesOfDistrict = { house: {}, senate: {} }
for (const chamber of ['house', 'senate']) {
  for (const [number, list] of Object.entries(districtCounties[chamber])) {
    countiesOfDistrict[chamber][number] = list.sort((a, b) => b.share - a.share).map((x) => x.fips)
  }
}
writeFileSync(
  path.join(here, '../src/data/montanaCountyDistricts.json'),
  JSON.stringify({ source: 'US Census TIGER/Line 2024 SLDL/SLDU, us-atlas 3.0.1 counties', counties: result, districts: countiesOfDistrict }, null, 1) + '\n',
)

// The map shapes: the counties and the state outline, with 4 decimal places.
const round = (g) => JSON.parse(JSON.stringify(g, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)))
const state = merge(us, us.objects.counties.geometries.filter(isMontana))
const shapes = {
  type: 'FeatureCollection',
  features: [
    ...counties.map((c) => ({ type: 'Feature', id: String(c.id), properties: { name: c.properties.name }, geometry: round(c.geometry) })),
    { type: 'Feature', id: 'state', properties: { name: 'Montana' }, geometry: round(state) },
  ],
}
writeFileSync(path.join(here, '../../public/maps/montana-counties.json'), JSON.stringify(shapes))
console.log(`${result.length} counties`)
