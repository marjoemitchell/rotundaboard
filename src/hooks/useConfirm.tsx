import { useCallback, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'

interface ConfirmOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>

type ConfirmState = ConfirmOptions & { message: string }

// Drop-in replacement for `window.confirm` styled to match the app instead
// of the browser chrome — `await confirm('Delete this note?')` resolves to
// a boolean the same way, but renders `confirmDialog` (mount it once,
// anywhere in the component) instead of a native dialog.
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null)
  const resolveRef = useRef<(value: boolean) => void>()

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({ message, danger: true, ...options })
    })
  }, [])

  const settle = (value: boolean) => {
    resolveRef.current?.(value)
    setState(null)
  }

  const confirmDialog = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return { confirm, confirmDialog }
}
