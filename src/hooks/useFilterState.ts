import { useCallback, useState } from 'react'
import type { FilterState } from '../types'

const FILTER_KEYS: (keyof FilterState)[] = [
  'status',
  'subject',
  'position',
  'momentumMin',
  'committee',
  'chamber',
  'sponsor',
  'party',
  'lastActionWithin',
]

function readFromUrl(): FilterState {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)
  const next: FilterState = {}
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (value) (next as Record<string, string>)[key] = value
  }
  return next
}

function writeToUrl(filters: FilterState) {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  for (const key of FILTER_KEYS) {
    if (filters[key]) params.set(key, filters[key] as string)
    else params.delete(key)
  }
  const query = params.toString()
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`
  window.history.replaceState(null, '', url)
}

export function useFilterState() {
  const [filters, setFilters] = useState<FilterState>(readFromUrl)

  const setFilter = useCallback((key: keyof FilterState, value: string | undefined) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value }
      if (!value) delete next[key]
      writeToUrl(next)
      return next
    })
  }, [])

  const removeFilter = useCallback((key: keyof FilterState) => {
    setFilters((prev) => {
      const next = { ...prev }
      delete next[key]
      writeToUrl(next)
      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({})
    writeToUrl({})
  }, [])

  return { filters, setFilter, removeFilter, clearFilters }
}
