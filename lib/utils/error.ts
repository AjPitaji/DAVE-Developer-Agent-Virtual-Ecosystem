/**
 * Supabase/PostgREST failures are thrown as plain objects
 * (`{ message, details, hint, code }`), not `Error` instances. Using
 * `err instanceof Error ? err.message : 'Something went wrong'` therefore
 * throws away the real reason — which is exactly the message that explains
 * what went wrong.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;

  if (err && typeof err === 'object') {
    const candidate = (err as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;

    const detail = (err as { details?: unknown }).details;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }

  if (typeof err === 'string' && err.trim()) return err;

  return fallback;
}
