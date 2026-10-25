/**
 * Pure utilities for generating + validating project keys.
 *
 * A project key is a short uppercase identifier (2–4 chars, A–Z/0–9) that
 * prefixes every task id, e.g. "DAVE" → key "DV", so tasks render as
 * "DV-1", "DV-2", ….
 *
 * The default algorithm:
 *   1. Strip non-alphanumerics and uppercase.
 *   2. If the name has multiple whitespace-separated words, take the
 *      first letter of each (up to 4). "My Cool App" → "MCA".
 *   3. If it's a single word, take the first letter plus the first
 *      consonant after the first vowel. "DAVE" → "DV", "GitHub" → "GT".
 *   4. Edge cases fall back to "TASK".
 *
 * Users can always override the suggested key in the Jim panel.
 */

const FALLBACK_KEY = 'TASK';
const MAX_KEY_LEN = 4;
const MIN_KEY_LEN = 2;
const KEY_REGEX = /^[A-Z0-9]+$/;
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

export function isValidProjectKey(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < MIN_KEY_LEN || value.length > MAX_KEY_LEN) return false;
  return KEY_REGEX.test(value);
}

/**
 * Normalize a free-form user key: strip whitespace, uppercase, drop
 * anything non-alphanumeric, clamp to 4 chars. Returns null if nothing
 * usable is left.
 */
export function normalizeProjectKey(value: string): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_KEY_LEN);
  return cleaned.length >= MIN_KEY_LEN ? cleaned : null;
}

export function generateProjectKey(name: string): string {
  if (!name || !name.trim()) return FALLBACK_KEY;
  const cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  if (!cleaned) return FALLBACK_KEY;

  // Multi-word: first letter of each (up to 4)
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, MAX_KEY_LEN)
      .map((w) => w[0])
      .join('')
      .slice(0, MAX_KEY_LEN);
  }

  // Single word: first letter + next consonant
  const word = words[0];
  if (word.length < 2) return (word || FALLBACK_KEY).slice(0, MAX_KEY_LEN);
  const first = word[0];
  for (let i = 1; i < word.length; i++) {
    if (!VOWELS.has(word[i])) {
      return (first + word[i]).slice(0, MAX_KEY_LEN);
    }
  }
  // All vowels (e.g. "AI") — just take the first two letters
  return word.slice(0, 2).slice(0, MAX_KEY_LEN);
}

/**
 * Format a project key + sequence number into the user-facing display id.
 * `key` is assumed valid; the caller should validate via isValidProjectKey.
 */
export function formatTaskDisplayId(key: string, num: number): string {
  return `${key}-${num}`;
}
