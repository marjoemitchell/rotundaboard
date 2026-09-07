import { useCallback, useRef, useState } from 'react'
import { PromptDialog } from '../components/shared/PromptDialog'

interface PromptOptions {
  title?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

type PromptState = PromptOptions & { message: string }

// Drop-in replacement for `window.prompt` styled to match the app —
// `await prompt('Name this filter:')` resolves to the entered string, or
// null if cancelled, the same way, but renders `promptDialog` (mount it
// once, anywhere in the component) instead of a native dialog.
export function usePrompt() {
  const [state, setState] = useState<PromptState | null>(null)
  const resolveRef = useRef<(value: string | null) => void>()

  const prompt = useCallback((message: string, options?: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve
      setState({ message, ...options })
    })
  }, [])

  const settle = (value: string | null) => {
    resolveRef.current?.(value)
    setState(null)
  }

  const promptDialog = state ? (
    <PromptDialog
      title={state.title}
      message={state.message}
      defaultValue={state.defaultValue}
      placeholder={state.placeholder}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      onSubmit={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  ) : null

  return { prompt, promptDialog }
}
