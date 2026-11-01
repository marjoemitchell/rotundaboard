import { useId, useMemo, useRef, useState } from 'react'
import type { SubjectCode, Tag } from '../types'
import styles from './SubjectPicker.module.css'

// The subject that the user picks. A "custom" pick with a new name makes a new custom subject.
export type SubjectPick = { kind: 'default'; code: string } | { kind: 'custom'; name: string }

type Option =
  | { key: string; kind: 'create'; name: string }
  | { key: string; kind: 'custom'; name: string }
  | { key: string; kind: 'default'; code: string; name: string }

// A dropdown that shows the default subjects and the custom subjects of the workspace.
// When no subject has the typed name, the dropdown can make a new custom subject.
export function SubjectPicker({
  defaultSubjects,
  customSubjects,
  onPick,
  disabled,
}: {
  defaultSubjects: SubjectCode[]
  customSubjects: Tag[]
  onPick: (pick: SubjectPick) => Promise<void> | void
  disabled?: boolean
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // The highlighted option. -1 means that no option is highlighted.
  const [active, setActive] = useState(-1)

  const { options, customCount, defaultCount } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const custom: Option[] = customSubjects
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .map((t) => ({ key: `custom:${t.id}`, kind: 'custom', name: t.name }))
    const defaults: Option[] = defaultSubjects
      .filter((s) => !q || s.description.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      .map((s) => ({ key: `default:${s.code}`, kind: 'default', code: s.code, name: s.description }))
    const exactMatch = [...custom, ...defaults].some((o) => o.name.toLowerCase() === q)
    const create: Option[] = q && !exactMatch ? [{ key: 'create', kind: 'create', name: query.trim() }] : []
    return { options: [...create, ...custom, ...defaults], customCount: custom.length, defaultCount: defaults.length }
  }, [query, customSubjects, defaultSubjects])

  const pick = async (option: Option) => {
    setQuery('')
    setActive(-1)
    if (option.kind === 'default') await onPick({ kind: 'default', code: option.code })
    else await onPick({ kind: 'custom', name: option.name })
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = options[active]
      if (open && option) void pick(option)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`
  const showList = open && options.length > 0

  const renderOption = (option: Option, index: number) => (
    <li
      key={option.key}
      id={optionId(index)}
      role="option"
      aria-selected={index === active}
      className={`${styles.option} ${index === active ? styles.optionActive : ''}`}
      // Keep the focus in the input, so that the list does not close before the click.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setActive(index)}
      onClick={() => void pick(option)}
    >
      {option.kind === 'create' ? (
        <span>Create custom subject “{option.name}”</span>
      ) : (
        <>
          <span>{option.name}</span>
          {option.kind === 'custom' && <span className={styles.customBadge}>Custom</span>}
        </>
      )}
    </li>
  )

  const createOffset = options.length - customCount - defaultCount

  return (
    <div className={styles.picker}>
      <input
        ref={inputRef}
        className={styles.input}
        role="combobox"
        aria-label="Add a subject"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? optionId(active) : undefined}
        placeholder="Add a subject…"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(e.target.value.trim() ? 0 : -1)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Subjects" className={styles.list}>
          {createOffset > 0 && renderOption(options[0], 0)}
          {customCount > 0 && (
            <li role="presentation" className={styles.groupLabel}>
              Custom subjects
            </li>
          )}
          {options.slice(createOffset, createOffset + customCount).map((o, i) => renderOption(o, createOffset + i))}
          {defaultCount > 0 && (
            <li role="presentation" className={styles.groupLabel}>
              Default subjects
            </li>
          )}
          {options.slice(createOffset + customCount).map((o, i) => renderOption(o, createOffset + customCount + i))}
        </ul>
      )}
    </div>
  )
}
