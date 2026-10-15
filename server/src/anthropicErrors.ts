import Anthropic from '@anthropic-ai/sdk'

/** True for an error from a missing, wrong, or not permitted Anthropic API key. */
export function isCredentialError(err: unknown): boolean {
  return err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError
}
