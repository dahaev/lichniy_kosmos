import type { components } from '@/api/schema'

import type { AccessMock } from './access'
import { TEST_CONSENT_VERSION } from './fixtures'
import { checkProfile } from './profileChecks'

type Schemas = components['schemas']

/**
 * Stand-in for `POST /api/v1/orders` until the slice 6 backend (SCR-05 §0.6,
 * ARCHITECTURE_MVP_v2 §11). It plays the server's side of the order: session,
 * gate, idempotency, consent version and the spending of the entitlement.
 *
 * The gate is closed by default (`legal_ready=false` or `generation=false`
 * answers `403 creation_unavailable`, nothing changes). This file has no way
 * to open it: the caller passes the gate in, and only the explicit dev test
 * mode in `handlers.ts` opens it.
 */

export const orderDetails = {
  unreadable: 'Запрос не разобран.',
  unauthenticated: 'Сессия закончилась. Введи код доступа ещё раз.',
  creationUnavailable: 'Создание разбора пока недоступно.',
  notFound: 'Доступ не найден.',
  consentOutdated: 'Условия обновились. Отметь согласие ещё раз.',
  entitlementUsed: 'По этому доступу уже создан разбор.',
  entitlementBlocked: 'Этот код сейчас недоступен. Напиши в поддержку.',
  keyReused: 'Не удалось создать заказ. Попробуй ещё раз.',
  calculationFailed: 'Не удалось рассчитать карту. Доступ не использован. Попробуй ещё раз.',
  rateLimited: 'Слишком много попыток. Подожди минуту и попробуй снова.',
} as const

/** `Idempotency-Key`: 16–80 characters of `[A-Za-z0-9_-]` (§11.1). */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What the server decides before it looks at the request (SCR-05 §0.5). */
export interface CreationGate {
  legalReady: boolean
  generation: boolean
}

/** Forced outcomes for the stand: `?orders=<name>` in the browser, an argument in tests. */
export type OrdersScenario =
  | 'consent-outdated'
  | 'blocked'
  | 'used'
  | 'calculation-failed'
  | 'nonexistent'
  | 'ambiguous'
  | 'rate-limited'

/** One-shot transport failures; they decide only what the client sees. */
export type OrdersFault = 'lost-request' | 'lost-response' | 'error-after-commit'

export interface CreateOrderInput {
  /** The `Idempotency-Key` header, or null when it is absent. */
  key: string | null
  body: unknown
  scenario?: OrdersScenario | null
}

export type CreateOrderOutcome =
  | { status: 200 | 201; body: Schemas['OrderCreated'] }
  | {
      status: 400 | 401 | 403 | 404 | 409 | 422 | 429
      code: Schemas['ErrorCode']
      detail: string
      fields?: Record<string, string>
      retryAfter?: number
    }

interface StoredOrder {
  id: string
  fingerprint: string
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** JSON with sorted keys: equal requests give equal strings (the mock's fingerprint). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function readRequest(body: unknown): { entitlement_id: string; profile: unknown; consent_version: string } | null {
  if (!isObject(body)) return null
  const keys = Object.keys(body)
  if (keys.length !== 3 || !['entitlement_id', 'profile', 'consent_version'].every((key) => keys.includes(key))) return null
  const { entitlement_id: entitlementId, profile, consent_version: consent } = body
  if (typeof entitlementId !== 'string' || !UUID.test(entitlementId)) return null
  if (typeof consent !== 'string' || consent.length === 0) return null
  return { entitlement_id: entitlementId, profile, consent_version: consent }
}

function orderId(n: number): string {
  return `00000000-0000-4000-8000-${(0xe0000 + n).toString(16).padStart(12, '0')}`
}

export function createOrdersMock(access: AccessMock, gate: () => CreationGate) {
  /** The version the "server" currently requires; the stand can move it (`consent-outdated`). */
  let serverConsent: string = TEST_CONSENT_VERSION
  let sequence = 0
  let fault: OrdersFault | null = null
  const byKey = new Map<string, StoredOrder>()
  const byEntitlement = new Map<string, StoredOrder>()

  function problem(
    status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
    code: Schemas['ErrorCode'],
    detail: string,
    extra: { fields?: Record<string, string>; retryAfter?: number } = {},
  ): CreateOrderOutcome {
    return { status, code, detail, ...extra }
  }

  function commit(entitlementId: string, key: string, fingerprint: string): StoredOrder | null {
    sequence += 1
    const order: StoredOrder = { id: orderId(sequence), fingerprint }
    if (!access.consume(entitlementId, order.id)) return null
    byKey.set(`${entitlementId}:${key}`, order)
    byEntitlement.set(entitlementId, order)
    return order
  }

  /** The state changes a scenario makes before the request is judged. */
  function applyScenario(scenario: OrdersScenario | null | undefined, entitlementId: string): CreateOrderOutcome | null {
    if (scenario === 'consent-outdated') serverConsent = `${TEST_CONSENT_VERSION.slice(0, -1)}1`
    // «Another tab created an order first» exists only where creation is open: a closed gate creates nothing.
    const { legalReady, generation } = gate()
    if (scenario === 'used' && legalReady && generation && !byEntitlement.has(entitlementId)) {
      commit(entitlementId, 'other-browser-tab', 'foreign-request')
    }
    if (scenario === 'blocked') {
      access.block(entitlementId)
      return problem(409, 'entitlement_blocked', orderDetails.entitlementBlocked)
    }
    return null
  }

  return {
    create(input: CreateOrderInput): CreateOrderOutcome {
      const { key, body, scenario } = input
      if (scenario === 'rate-limited') return problem(429, 'rate_limited', orderDetails.rateLimited, { retryAfter: 60 })
      if (key === null || !IDEMPOTENCY_KEY.test(key)) return problem(400, 'validation_failed', orderDetails.unreadable)

      const entitlement = access.sessionEntitlement()
      if (!entitlement) return problem(401, 'unauthenticated', orderDetails.unauthenticated)

      const request = readRequest(body)
      const profileMode = scenario === 'nonexistent' || scenario === 'ambiguous' ? scenario : null
      const checked = request ? checkProfile(request.profile, profileMode) : null
      if (!request || checked?.status === 400) return problem(400, 'validation_failed', orderDetails.unreadable)
      if (request.entitlement_id !== entitlement.id) return problem(404, 'not_found', orderDetails.notFound)

      const forced = applyScenario(scenario, entitlement.id)
      if (forced) return forced

      // Equal requests are told apart by value, not by the form the client typed them in.
      const normalized = checked?.status === 200 ? checked.body.profile : request.profile
      const fingerprint = canonical({ ...request, profile: normalized })

      const replay = byKey.get(`${entitlement.id}:${key}`)
      if (replay) {
        if (replay.fingerprint !== fingerprint) return problem(409, 'idempotency_key_reused', orderDetails.keyReused)
        return { status: 200, body: { id: replay.id, status: 'queued' } }
      }

      const { legalReady, generation } = gate()
      if (!legalReady || !generation) return problem(403, 'creation_unavailable', orderDetails.creationUnavailable)

      const existing = byEntitlement.get(entitlement.id)
      if (existing || entitlement.state === 'consumed') {
        if (existing?.fingerprint !== fingerprint) return problem(409, 'entitlement_used', orderDetails.entitlementUsed)
        return { status: 200, body: { id: existing.id, status: 'queued' } }
      }

      if (request.consent_version !== serverConsent) return problem(409, 'consent_outdated', orderDetails.consentOutdated)
      if (checked?.status === 422) {
        return problem(422, checked.code, checked.detail, checked.fields ? { fields: checked.fields } : {})
      }
      if (scenario === 'calculation-failed') return problem(422, 'calculation_failed', orderDetails.calculationFailed)

      const order = commit(entitlement.id, key, fingerprint)
      if (!order) return problem(409, 'entitlement_used', orderDetails.entitlementUsed)
      return { status: 201, body: { id: order.id, status: 'queued' } }
    },

    /** The version the server requires now; the test-mode `GET /config` serves it. */
    consentVersion: (): string => serverConsent,

    /** Arms a one-shot transport failure for the next request. */
    inject(next: OrdersFault): void {
      fault = next
    },

    /** The armed failure, once. */
    takeFault(): OrdersFault | null {
      const taken = fault
      fault = null
      return taken
    },

    /** How many orders exist: the double-creation checks count this. */
    orderCount: (): number => new Set([...byEntitlement.values()].map((order) => order.id)).size,

    reset(): void {
      serverConsent = TEST_CONSENT_VERSION
      sequence = 0
      fault = null
      byKey.clear()
      byEntitlement.clear()
    },
  }
}

export type OrdersMock = ReturnType<typeof createOrdersMock>
