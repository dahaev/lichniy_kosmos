import type { components } from '@/api/schema'

// The result of the review check (SCR-04 §0.4, Р-A7): a SHA-256 of the
// profile the server accepted, never a copy of it. Only a navigation rule
// for /create/access — the server validates the profile again with the order.

type Profile = components['schemas']['Profile']

export const CHECK_KEY = 'cosmos.intake.check.v1'
export const CHECK_VERSION = 1
/** The lifetime of the draft it belongs to, `DRAFT_TTL_MS` (draft.ts imports this module). */
export const CHECK_TTL_MS = 24 * 60 * 60 * 1000

interface StoredCheck {
  version: number
  fingerprint: string
  checkedAt: number
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** JSON with keys sorted at every level, so equal profiles give equal bytes. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function profileFingerprint(profile: Profile): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(profile))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The stored fingerprint, or null when it is missing, foreign, expired or damaged. */
export function parseCheck(raw: string | null, now: number = Date.now()): string | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { version, fingerprint, checkedAt } = data as Record<string, unknown>
  if (version !== CHECK_VERSION || typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) return null
  if (typeof checkedAt !== 'number' || now - checkedAt > CHECK_TTL_MS || checkedAt > now + 60_000) return null
  return fingerprint
}

/**
 * Remembers that the server accepted exactly this profile. Never throws:
 * without a stored check the access guard sends the visitor back to the review.
 */
export async function recordCheck(profile: Profile, now: number = Date.now()): Promise<void> {
  try {
    const stored: StoredCheck = { version: CHECK_VERSION, fingerprint: await profileFingerprint(profile), checkedAt: now }
    storage()?.setItem(CHECK_KEY, JSON.stringify(stored))
  } catch {
    // No Web Crypto, private mode or a full quota.
  }
}

export function clearCheck(): void {
  try {
    storage()?.removeItem(CHECK_KEY)
  } catch {
    // Nothing stored to clear.
  }
}

/** True when the current profile is the one the server last accepted in this tab. */
export async function isCheckedProfile(profile: Profile, now: number = Date.now()): Promise<boolean> {
  let raw: string | null
  try {
    raw = storage()?.getItem(CHECK_KEY) ?? null
  } catch {
    return false
  }
  const stored = parseCheck(raw, now)
  if (stored === null) {
    if (raw !== null) clearCheck()
    return false
  }
  try {
    return stored === (await profileFingerprint(profile))
  } catch {
    return false
  }
}
