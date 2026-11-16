import type { components } from '@/api/schema'

type Schemas = components['schemas']

/**
 * Stand-in for `GET /api/v1/session` and `POST /api/v1/auth/code` until
 * slice 5 backend (SCR-04 §0.3). One instance plays one browser: the session
 * lives in memory, as the HttpOnly cookie would, and disappears on reload.
 *
 * The check symbol of a 2.0 code (ARCHITECTURE_MVP_v2 §10.1) is the server's
 * algorithm and is not computed here: the mock checks the prefix, the
 * alphabet and the length, then looks the code up in a synthetic registry.
 * Code values never reach a response body, a detail text or a log.
 */

/** Synthetic codes only (AGENTS.md); none of them exists anywhere else. */
export const syntheticCodes = {
  available: 'LK-FREE0-00000-00000-00000-0F001',
  availableOther: 'LK-FREE0-00000-00000-00000-0F002',
  consumed: 'LK-SPENT-00000-00000-00000-0S001',
  boundToAccount: 'LK-ACCT0-00000-00000-00000-0A001',
  blocked: 'LK-DENY0-00000-00000-00000-0D001',
  unknown: 'LK-ZZZZZ-00000-00000-00000-0Z001',
} as const

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const RATE_LIMIT_FAILURES = 5
export const RATE_LIMIT_WINDOW_MS = 60_000

export const accessDetails = {
  unreadable: 'Запрос не разобран.',
  malformed: 'Код не распознан. Проверь, что он введён полностью. Если код получен до запуска нового сайта, напиши в поддержку.',
  invalid: 'Этот код не подходит. Проверь, что он введён полностью, или напиши в поддержку.',
  boundToAccount: 'Этот код уже привязан к личному кабинету, поэтому его нельзя ввести здесь.',
  sessionConflict: 'В этом браузере уже открыт другой код. Подтверди замену, чтобы продолжить с новым.',
  rateLimited: 'Слишком много попыток. Подожди минуту и попробуй снова.',
} as const

interface Entitlement {
  id: string
  state: 'available' | 'consumed' | 'blocked'
  boundToAccount: boolean
  orderId?: string
}

const CODE_BODY = /^[0-9A-HJKMNP-TV-Z]{25}$/
const CODE_MAX_LENGTH = 64

/**
 * The code body without the `LK` prefix, or null when the input cannot be a
 * 2.0 code. Case, spaces and hyphens do not matter; O reads as 0, I and L as 1.
 */
export function normalizeCode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s-]/g, '')
  if (!compact.startsWith('LK')) return null
  const body = compact.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1')
  return CODE_BODY.test(body) ? body : null
}

function registry(): Map<string, Entitlement> {
  const entries: [string, Entitlement][] = [
    [syntheticCodes.available, { id: '00000000-0000-4000-8000-00000000f001', state: 'available', boundToAccount: false }],
    [syntheticCodes.availableOther, { id: '00000000-0000-4000-8000-00000000f002', state: 'available', boundToAccount: false }],
    [
      syntheticCodes.consumed,
      { id: '00000000-0000-4000-8000-00000000c001', state: 'consumed', boundToAccount: false, orderId: '00000000-0000-4000-8000-0000000d0001' },
    ],
    [syntheticCodes.boundToAccount, { id: '00000000-0000-4000-8000-00000000a001', state: 'available', boundToAccount: true }],
    [syntheticCodes.blocked, { id: '00000000-0000-4000-8000-00000000b001', state: 'blocked', boundToAccount: false }],
  ]
  return new Map(entries.map(([code, entitlement]) => [normalizeCode(code) ?? '', entitlement]))
}

export type CodeLoginOutcome =
  | { status: 200; body: Schemas['CodeSession'] }
  | { status: 400 | 403 | 409 | 422 | 429; code: Schemas['ErrorCode']; detail: string; retryAfter?: number }

interface ActiveSession {
  key: string
  expiresAt: number
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function readLogin(body: unknown): Schemas['CodeLogin'] | null {
  if (!isObject(body)) return null
  if (Object.keys(body).some((key) => key !== 'code' && key !== 'replace_session')) return null
  const { code, replace_session: replace } = body
  if (typeof code !== 'string' || code.length === 0 || code.length > CODE_MAX_LENGTH) return null
  if (replace !== undefined && typeof replace !== 'boolean') return null
  return replace === undefined ? { code } : { code, replace_session: replace }
}

/** The entitlement of the live session, as the orders mock needs it. */
export interface SessionEntitlement {
  id: string
  state: 'available' | 'consumed'
  orderId?: string
}

export function createAccessMock(now: () => number = Date.now) {
  let entitlements = registry()
  let current: ActiveSession | null = null
  /** A session whose code was blocked: it no longer creates anything, but still reads its order (SCR-06 decision 9). */
  let blocked: ActiveSession | null = null
  let failures: number[] = []

  function findById(id: string): Entitlement | undefined {
    return [...entitlements.values()].find((entitlement) => entitlement.id === id)
  }

  function codeSession(session: ActiveSession): Schemas['CodeSession'] {
    const entitlement = entitlements.get(session.key)
    if (!entitlement) throw new Error('session without entitlement')
    const base = { id: entitlement.id, code_mask: session.key.slice(-4) }
    return {
      principal: 'code',
      expires_at: new Date(session.expiresAt).toISOString(),
      entitlement:
        entitlement.state === 'consumed' && entitlement.orderId
          ? { ...base, state: 'consumed', order_id: entitlement.orderId }
          : { ...base, state: 'available' },
    }
  }

  /** Seconds until the oldest failure leaves the window, or 0 when attempts are open. */
  function lockedFor(): number {
    const at = now()
    failures = failures.filter((t) => at - t < RATE_LIMIT_WINDOW_MS)
    if (failures.length < RATE_LIMIT_FAILURES) return 0
    const oldest = failures[0] ?? at
    return Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - at) / 1000))
  }

  function fail(status: 403 | 422, code: Schemas['ErrorCode'], detail: string): CodeLoginOutcome {
    failures.push(now())
    return { status, code, detail }
  }

  function readSession(): Schemas['Session'] {
    if (current && current.expiresAt <= now()) current = null
    // A blocked entitlement has no valid session (ARCHITECTURE_MVP_v2 §9.2); reading is kept apart.
    if (current && entitlements.get(current.key)?.state === 'blocked') {
      blocked = current
      current = null
    }
    // So has an entitlement the owner has just bound to an account (§9.2).
    if (current && entitlements.get(current.key)?.boundToAccount) current = null
    return current ? codeSession(current) : { principal: 'anonymous' }
  }

  return {
    session: readSession,

    /**
     * Who may READ an existing order (SCR-06 decision 9). Reading does not
     * depend on the right to create new orders: a code blocked for new paid
     * steps still opens its finished order (Q9). It does end with the session
     * itself (expiry) and when the entitlement is bound to an account (§9.2).
     */
    readAccess(): { entitlementId: string; orderId?: string } | null {
      readSession()
      const session = current ?? blocked
      const entitlement = session && session.expiresAt > now() ? entitlements.get(session.key) : undefined
      if (!entitlement || entitlement.boundToAccount) return null
      return entitlement.orderId ? { entitlementId: entitlement.id, orderId: entitlement.orderId } : { entitlementId: entitlement.id }
    },

    /** An account claimed the code: every code session of this entitlement stops being valid. */
    bindToAccount(entitlementId: string): void {
      const entitlement = findById(entitlementId)
      if (entitlement) entitlement.boundToAccount = true
    },

    /** The entitlement of the live code session, or null without one. */
    sessionEntitlement(): SessionEntitlement | null {
      const session = readSession()
      if (session.principal !== 'code') return null
      const { id, state } = session.entitlement
      return state === 'consumed' ? { id, state, orderId: session.entitlement.order_id } : { id, state }
    },

    /** Order creation spends the entitlement; the session then shows `order_id`. */
    consume(entitlementId: string, orderId: string): boolean {
      const entitlement = findById(entitlementId)
      if (entitlement?.state !== 'available') return false
      entitlement.state = 'consumed'
      entitlement.orderId = orderId
      return true
    },

    /** The owner blocked the code while the session was open. */
    block(entitlementId: string): void {
      const entitlement = findById(entitlementId)
      if (entitlement) entitlement.state = 'blocked'
    },

    login(body: unknown): CodeLoginOutcome {
      const login = readLogin(body)
      if (!login) return { status: 400, code: 'validation_failed', detail: accessDetails.unreadable }
      const retryAfter = lockedFor()
      if (retryAfter > 0) return { status: 429, code: 'rate_limited', detail: accessDetails.rateLimited, retryAfter }

      const key = normalizeCode(login.code)
      if (!key) return fail(422, 'code_malformed', accessDetails.malformed)
      const entitlement = entitlements.get(key)
      if (!entitlement || entitlement.state === 'blocked') return fail(422, 'code_invalid', accessDetails.invalid)
      if (entitlement.boundToAccount) return fail(403, 'code_bound_to_account', accessDetails.boundToAccount)

      if (current && current.expiresAt <= now()) current = null
      if (current?.key === key) return { status: 200, body: codeSession(current) }
      if (current && login.replace_session !== true) {
        return { status: 409, code: 'session_conflict', detail: accessDetails.sessionConflict }
      }
      current = { key, expiresAt: now() + SESSION_TTL_MS }
      blocked = null
      return { status: 200, body: codeSession(current) }
    },

    /** Dev switch `?session=code-available|code-consumed`: start inside a code session. */
    seed(kind: 'available' | 'consumed'): void {
      const code = kind === 'available' ? syntheticCodes.available : syntheticCodes.consumed
      current = { key: normalizeCode(code) ?? '', expiresAt: now() + SESSION_TTL_MS }
      blocked = null
    },

    reset(): void {
      current = null
      blocked = null
      failures = []
      entitlements = registry()
    },
  }
}

export type AccessMock = ReturnType<typeof createAccessMock>
