import { createApiClient, fetchConfig, type ApiClient, type PublicConfig } from '@/api/client'
import { ApiProblem } from '@/api/problem'
import type { components } from '@/api/schema'
import { parseRetryAfter, type CodeSession } from '@/features/access/access'
import type { IntakeDraft } from '@/features/intake/draft'
import { profileFingerprint } from '@/features/intake/checkStamp'
import { toProfile, type Profile } from '@/features/intake/review'
import { formatDate } from '@/features/intake/validation'

// SCR-05: the last step before an order (SCR-05 §0). Local logic only: which
// mode creation is in, the summary, the idempotency attempt and what each
// answer of `POST /api/v1/orders` means. The code the visitor typed never
// reaches this file: the screen knows the access by its id and mask.

export type Session = components['schemas']['Session']

export const consentTexts = {
  checking: 'Проверяем доступ…',
  submitting: 'Создаём заказ…',
  recovering: 'Проверяем, создан ли заказ…',
  cost: 'При создании заказа будет использован один доступ.',
  needConsent: 'Отметь согласие, чтобы создать разбор.',
  blocked: 'Создание разбора пока недоступно.',
  generationOff: 'Создание разборов сейчас недоступно. Анкета останется в этой вкладке — вернись позже.',
  configError: 'Не удалось проверить условия создания. Проверь соединение и попробуй ещё раз.',
  consentOutdated: 'Условия обновились. Отметь согласие ещё раз.',
  entitlementUsed: 'По этому доступу уже создан разбор.',
  entitlementBlocked: 'Этот код сейчас недоступен. Напиши в поддержку.',
  failed: 'Не удалось создать заказ. Попробуй ещё раз.',
  fixProfile: 'Нужно поправить данные анкеты.',
  calculationFailed: 'Не удалось рассчитать карту. Доступ не использован. Попробуй ещё раз.',
  rateLimited: 'Слишком много попыток. Подожди немного и попробуй снова.',
  unknown: 'Не удалось получить ответ. Заказ мог быть создан. Проверь ещё раз — второй заказ не появится.',
} as const

// ─── Creation mode ────────────────────────────────────────────────────────

/**
 * What the screen may do (SCR-05 §0.5), closed by default:
 * - `blocked`: no legal permission (`legal_ready=false`, Q12 open) or an open
 *   configuration that is not the mock stand's: real creation waits for Q12;
 * - `generation_off`: `features.generation=false` (К11, owner decision 1);
 * - `test`: the dev build served by MSW with the explicit test configuration.
 * `live` arrives with Q12 and is not implemented: a real open configuration
 * reads as `blocked`.
 */
export type CreationMode = 'blocked' | 'generation_off' | 'test'

export interface CreationConditions {
  config: PublicConfig
  /** The configuration came from the MSW stand (`x-cosmos-mock`). */
  mocked: boolean
  /** A development build. A compile-time constant: production bundles drop the test path. */
  devBuild: boolean
}

export function creationMode({ config, mocked, devBuild }: CreationConditions): CreationMode {
  if (!config.legal_ready || config.consent_version === '') return 'blocked'
  if (!config.features.generation) return 'generation_off'
  return devBuild && mocked ? 'test' : 'blocked'
}

// ─── Session and configuration ────────────────────────────────────────────

export type SessionRead = { kind: 'read'; session: Session } | { kind: 'failed' }

/** GET /api/v1/session; unlike the access screen, a failed read is told apart from «no session». */
export async function readSession(signal: AbortSignal, client: ApiClient = createApiClient()): Promise<SessionRead> {
  try {
    const { data } = await client.GET('/api/v1/session', { signal })
    return data ? { kind: 'read', session: data } : { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}

export interface ConfigRead {
  config: PublicConfig
  mocked: boolean
}

/** GET /api/v1/config; null when it cannot be read, which keeps creation shut. */
export async function readConfig(client: ApiClient = createApiClient()): Promise<ConfigRead | null> {
  try {
    return await fetchConfig(client)
  } catch {
    return null
  }
}

export type ConsentSetup =
  | { kind: 'signed_out' }
  | { kind: 'ordered'; orderId: string }
  | { kind: 'failed' }
  | { kind: 'ready'; session: CodeSession; config: PublicConfig; mocked: boolean }

/**
 * §0.3 items 3–5: the session and the configuration, read together. A missing
 * or ended session and a used access leave the screen; anything unreadable
 * keeps creation shut.
 */
export async function loadSetup(signal: AbortSignal, client: ApiClient = createApiClient()): Promise<ConsentSetup> {
  const [read, configRead] = await Promise.all([
    readSession(signal, client),
    readConfig(client),
  ])
  if (read.kind === 'failed') return { kind: 'failed' }
  const { session } = read
  if (session.principal !== 'code') return { kind: 'signed_out' }
  if (session.entitlement.state === 'consumed') return { kind: 'ordered', orderId: session.entitlement.order_id }
  if (!configRead) return { kind: 'failed' }
  return { kind: 'ready', session, config: configRead.config, mocked: configRead.mocked }
}

// ─── Summary ──────────────────────────────────────────────────────────────

export interface Summary {
  name: string
  /** «12 марта 1990 · Казань · 14:30» */
  details: string
}

/** «12 марта 1990»: the review's spelling of the date, without its weekday. */
function spelledDate(birthDate: string): string {
  const [year, month, day] = birthDate.split('-').map(Number) as [number, number, number]
  const spelled = formatDate({ year, month, day })
  return spelled.slice(0, spelled.lastIndexOf(', '))
}

/** The summary written the way SCR-05 §0.9 shows it. */
export function summaryOf(profile: Profile, place: { name: string }): Summary {
  const time = profile.time.kind === 'unknown' ? 'время неизвестно' : profile.time.value
  return { name: profile.name, details: [spelledDate(profile.birth_date), place.name, time].join(' · ') }
}

/** What the screen needs from a complete draft: the request's profile and its summary. */
export function orderSubject(draft: IntakeDraft): { profile: Profile; summary: Summary } | null {
  const profile = toProfile(draft)
  const place = draft.place.selected
  return profile && place ? { profile, summary: summaryOf(profile, place) } : null
}

// ─── Idempotency attempt (§0.7) ───────────────────────────────────────────

export const ATTEMPT_KEY = 'cosmos.order.attempt.v1'
export const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000
/** `Idempotency-Key` of the contract: 16–80 characters of `[A-Za-z0-9_-]`. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,80}$/

/** What an attempt belongs to. No code and no profile: only ids and a hash. */
export interface AttemptScope {
  entitlementId: string
  fingerprint: string
  consentVersion: string
}

export interface OrderAttempt extends AttemptScope {
  key: string
  createdAt: number
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The stored attempt, or null when it is missing, damaged or expired. */
export function parseAttempt(raw: string | null, now: number = Date.now()): OrderAttempt | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { key, entitlementId, fingerprint, consentVersion, createdAt } = data as Record<string, unknown>
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return null
  if (typeof entitlementId !== 'string' || typeof fingerprint !== 'string' || typeof consentVersion !== 'string') return null
  if (typeof createdAt !== 'number' || now - createdAt > ATTEMPT_TTL_MS || createdAt > now + 60_000) return null
  return { key, entitlementId, fingerprint, consentVersion, createdAt }
}

function save(attempt: OrderAttempt): void {
  try {
    storage()?.setItem(ATTEMPT_KEY, JSON.stringify(attempt))
  } catch {
    // Private mode or a full quota: the screen keeps the attempt in memory.
  }
}

/** A fresh key for this scope; replaces whatever was stored. */
export function renewAttempt(scope: AttemptScope, now: number = Date.now()): OrderAttempt {
  const attempt: OrderAttempt = { ...scope, key: newKey(), createdAt: now }
  save(attempt)
  return attempt
}

/**
 * The key of this access, profile and consent version: kept on a re-entry,
 * new when any of the three changed (§0.7).
 */
export function openAttempt(scope: AttemptScope, now: number = Date.now()): OrderAttempt {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(ATTEMPT_KEY) ?? null
  } catch {
    raw = null
  }
  const stored = parseAttempt(raw, now)
  const same =
    stored?.entitlementId === scope.entitlementId &&
    stored.fingerprint === scope.fingerprint &&
    stored.consentVersion === scope.consentVersion
  return stored && same ? stored : renewAttempt(scope, now)
}

export function clearAttempt(): void {
  try {
    storage()?.removeItem(ATTEMPT_KEY)
  } catch {
    // Nothing stored to clear.
  }
}

export function attemptScope(entitlementId: string, profile: Profile, consentVersion: string): Promise<AttemptScope> {
  return profileFingerprint(profile).then((fingerprint) => ({ entitlementId, fingerprint, consentVersion }))
}

// ─── POST /api/v1/orders ──────────────────────────────────────────────────

/** What the screen does with a refused or lost request (SCR-05 §0.8). */
export type OrderFailure =
  | { kind: 'signed_out' }
  | { kind: 'unavailable' }
  | { kind: 'consent_outdated' }
  | { kind: 'entitlement_used' }
  | { kind: 'entitlement_blocked' }
  | { kind: 'key_reused' }
  | { kind: 'stale' }
  | { kind: 'fix_profile'; message: string }
  | { kind: 'calculation_failed' }
  | { kind: 'limited'; message: string; retryAfter: number | null }
  | { kind: 'failed'; message: string }
  /** No usable answer: the order may exist. Read the session before anything else. */
  | { kind: 'unknown' }

const profileFields = new Set(['validation_failed', 'place_not_found', 'birth_time_nonexistent', 'birth_time_ambiguous'])

/** Branches on the problem code, never on the text (§15.1); the status only tells «lost» from «refused». */
export function orderFailure(problem: ApiProblem, retryAfter: number | null = null): OrderFailure {
  if (problem.status === 0 || problem.status >= 500) return { kind: 'unknown' }
  switch (problem.code) {
    case 'unauthenticated':
      return { kind: 'signed_out' }
    case 'creation_unavailable':
      return { kind: 'unavailable' }
    case 'consent_outdated':
      return { kind: 'consent_outdated' }
    case 'entitlement_used':
      return { kind: 'entitlement_used' }
    case 'entitlement_blocked':
      return { kind: 'entitlement_blocked' }
    case 'idempotency_key_reused':
      return { kind: 'key_reused' }
    case 'not_found':
      return { kind: 'stale' }
    case 'calculation_failed':
      return { kind: 'calculation_failed' }
    case 'rate_limited':
      return { kind: 'limited', message: problem.detail ?? consentTexts.rateLimited, retryAfter }
    default:
      if (problem.status === 422 && profileFields.has(problem.code)) {
        return { kind: 'fix_profile', message: problem.detail ?? consentTexts.fixProfile }
      }
      return { kind: 'failed', message: consentTexts.failed }
  }
}

export class OrderRefused extends Error {
  readonly failure: OrderFailure

  constructor(failure: OrderFailure, options?: ErrorOptions) {
    super(failure.kind, options)
    this.name = 'OrderRefused'
    this.failure = failure
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An id the router may carry: the screen leaves for SCR-06 only with one (М06). */
export function isOrderId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export interface OrderRequest {
  key: string
  entitlementId: string
  profile: Profile
  consentVersion: string
}

/**
 * POST /api/v1/orders with the attempt's key. Resolves with the confirmed
 * `order_id` (201 and 200 alike) or throws `OrderRefused`; a lost request, a
 * 5xx or an unreadable success are all `unknown`. Aborting is not a failure:
 * the screen left.
 */
export async function placeOrder(request: OrderRequest, signal: AbortSignal, client: ApiClient = createApiClient()): Promise<string> {
  let result
  try {
    result = await client.POST('/api/v1/orders', {
      params: { header: { 'Idempotency-Key': request.key } },
      body: { entitlement_id: request.entitlementId, profile: request.profile, consent_version: request.consentVersion },
      signal,
    })
  } catch (cause) {
    if (signal.aborted) throw cause
    throw new OrderRefused({ kind: 'unknown' }, { cause })
  }
  const { data, error, response } = result
  if (data) {
    if (isOrderId(data.id)) return data.id
    throw new OrderRefused({ kind: 'unknown' })
  }
  if (response.ok) throw new OrderRefused({ kind: 'unknown' })
  const problem = ApiProblem.fromResponse(response.status, error)
  throw new OrderRefused(orderFailure(problem, parseRetryAfter(response.headers.get('retry-after'))))
}

/**
 * §0.7 step 2: one read of the session, no side effects. The id of the order
 * the same access already made, or null when there is none or the read failed.
 */
export async function recoverOrderId(entitlementId: string, signal: AbortSignal, client: ApiClient = createApiClient()): Promise<string | null> {
  const read = await readSession(signal, client)
  if (read.kind !== 'read' || read.session.principal !== 'code') return null
  const { entitlement } = read.session
  return entitlement.state === 'consumed' && entitlement.id === entitlementId && isOrderId(entitlement.order_id) ? entitlement.order_id : null
}
