import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from '@/api/client'

import {
  accessDetails,
  createAccessMock,
  normalizeCode,
  RATE_LIMIT_FAILURES,
  RATE_LIMIT_WINDOW_MS,
  SESSION_TTL_MS,
  syntheticCodes,
  type AccessMock,
} from './access'
import { accessMock } from './handlers'

const SYNTHETIC_CODE = /^LK-(FREE0|SPENT|ACCT0|DENY0|ZZZZZ)-00000-00000-00000-0[A-Z][0-9]{3}$/

const start = Date.parse('2026-11-12T09:00:00Z')

function mockAt(): { mock: AccessMock; advance: (ms: number) => void } {
  let at = start
  return { mock: createAccessMock(() => at), advance: (ms) => (at += ms) }
}

describe('synthetic codes', () => {
  it('follow the synthetic pattern and parse as 2.0 codes', () => {
    for (const code of Object.values(syntheticCodes)) {
      expect(code).toMatch(SYNTHETIC_CODE)
      expect(normalizeCode(code)).not.toBeNull()
    }
  })
})

describe('normalizeCode', () => {
  it('ignores case, spaces and hyphens and reads O, I, L as digits', () => {
    const body = normalizeCode(syntheticCodes.available)
    expect(normalizeCode('lk free0 00000-00000 00000 0f001')).toBe(body)
    expect(normalizeCode('LK-FREEO-OOOOO-OOOOO-OOOOO-OFOO1')).toBe(body)
    expect(normalizeCode('LK-FREE0-00000-00000-00000-0F00I')).toBe(body)
    expect(normalizeCode('LK-FREE0-00000-00000-00000-0F00L')).toBe(body)
  })

  it.each([
    ['no prefix', 'FREE0-00000-00000-00000-0F001'],
    ['a short code', 'LK-FREE0-00000'],
    ['a long code', `${syntheticCodes.available}0`],
    ['a letter outside the alphabet', 'LK-FREE0-00000-00000-00000-0F00U'],
    ['an old-style code', 'ABC-123-456'],
  ])('rejects %s', (_, input) => {
    expect(normalizeCode(input)).toBeNull()
  })
})

describe('code login mock', () => {
  it('starts anonymous', () => {
    expect(mockAt().mock.session()).toEqual({ principal: 'anonymous' })
  })

  it('opens a session for a free code without an order', () => {
    const { mock } = mockAt()
    const outcome = mock.login({ code: syntheticCodes.available })

    expect(outcome).toEqual({
      status: 200,
      body: {
        principal: 'code',
        expires_at: new Date(start + SESSION_TTL_MS).toISOString(),
        entitlement: { id: '00000000-0000-4000-8000-00000000f001', state: 'available', code_mask: 'F001' },
      },
    })
    expect(mock.session()).toEqual(outcome.status === 200 ? outcome.body : null)
  })

  it('opens a session with the existing order for a used code', () => {
    const outcome = mockAt().mock.login({ code: syntheticCodes.consumed })

    expect(outcome.status).toBe(200)
    if (outcome.status !== 200) return
    expect(outcome.body.entitlement).toEqual({
      id: '00000000-0000-4000-8000-00000000c001',
      state: 'consumed',
      code_mask: 'S001',
      order_id: '00000000-0000-4000-8000-0000000d0001',
    })
  })

  it('answers malformed input with the old-site hint', () => {
    const { mock } = mockAt()
    expect(mock.login({ code: 'ABC-123-456' })).toEqual({ status: 422, code: 'code_malformed', detail: accessDetails.malformed })
    expect(mock.session()).toEqual({ principal: 'anonymous' })
  })

  it('gives unknown and blocked codes one indistinguishable answer', () => {
    const { mock } = mockAt()
    const unknown = mock.login({ code: syntheticCodes.unknown })
    const blocked = mock.login({ code: syntheticCodes.blocked })

    expect(unknown).toEqual({ status: 422, code: 'code_invalid', detail: accessDetails.invalid })
    expect(blocked).toEqual(unknown)
  })

  it('refuses a code bound to an account without a session', () => {
    const { mock } = mockAt()
    expect(mock.login({ code: syntheticCodes.boundToAccount })).toEqual({
      status: 403,
      code: 'code_bound_to_account',
      detail: accessDetails.boundToAccount,
    })
    expect(mock.session()).toEqual({ principal: 'anonymous' })
  })

  it.each([
    ['not an object', 'LK-FREE0'],
    ['an array', [syntheticCodes.available]],
    ['no code', {}],
    ['an empty code', { code: '' }],
    ['a code over 64 characters', { code: 'L'.repeat(65) }],
    ['a non-boolean replace flag', { code: syntheticCodes.available, replace_session: 'yes' }],
    ['an unknown field', { code: syntheticCodes.available, remember: true }],
  ])('rejects %s as an unreadable body', (_, body) => {
    expect(mockAt().mock.login(body)).toMatchObject({ status: 400, code: 'validation_failed' })
  })
})

describe('session replacement', () => {
  it('repeats the same code without a conflict and keeps the session as is', () => {
    const { mock, advance } = mockAt()
    const first = mock.login({ code: syntheticCodes.available })
    advance(60_000)
    const again = mock.login({ code: 'lk-free0-00000-00000-00000-0f001' })

    expect(again).toEqual(first)
  })

  it('does not replace a session with another code without consent', () => {
    const { mock } = mockAt()
    mock.login({ code: syntheticCodes.available })
    const before = mock.session()

    expect(mock.login({ code: syntheticCodes.availableOther })).toEqual({
      status: 409,
      code: 'session_conflict',
      detail: accessDetails.sessionConflict,
    })
    expect(mock.login({ code: syntheticCodes.consumed, replace_session: false })).toMatchObject({ status: 409 })
    expect(mock.session()).toEqual(before)
  })

  it('replaces the session after explicit consent', () => {
    const { mock } = mockAt()
    mock.login({ code: syntheticCodes.consumed })
    const outcome = mock.login({ code: syntheticCodes.availableOther, replace_session: true })

    expect(outcome).toMatchObject({ status: 200, body: { entitlement: { state: 'available', code_mask: 'F002' } } })
    expect(mock.session()).toMatchObject({ principal: 'code', entitlement: { code_mask: 'F002' } })
  })

  it.each([
    ['malformed', 'ABC-123-456', 422],
    ['unknown', syntheticCodes.unknown, 422],
    ['blocked', syntheticCodes.blocked, 422],
    ['bound to an account', syntheticCodes.boundToAccount, 403],
  ])('keeps the old session when a replacement code is %s', (_, code, status) => {
    const { mock } = mockAt()
    mock.login({ code: syntheticCodes.available })
    const before = mock.session()

    expect(mock.login({ code, replace_session: true }).status).toBe(status)
    expect(mock.session()).toEqual(before)
  })

  it('lets a new code in without a conflict once the session has expired', () => {
    const { mock, advance } = mockAt()
    mock.login({ code: syntheticCodes.available })
    advance(SESSION_TTL_MS)

    expect(mock.session()).toEqual({ principal: 'anonymous' })
    expect(mock.login({ code: syntheticCodes.availableOther }).status).toBe(200)
  })
})

describe('attempt limit', () => {
  function exhaust(mock: AccessMock) {
    for (let i = 0; i < RATE_LIMIT_FAILURES; i++) mock.login({ code: syntheticCodes.unknown })
  }

  it('locks attempts after repeated failures, a valid code included', () => {
    const { mock, advance } = mockAt()
    exhaust(mock)
    advance(20_000)

    expect(mock.login({ code: syntheticCodes.available })).toEqual({
      status: 429,
      code: 'rate_limited',
      detail: accessDetails.rateLimited,
      retryAfter: 40,
    })
    expect(mock.session()).toEqual({ principal: 'anonymous' })
  })

  it('accepts a retry once the window has passed', () => {
    const { mock, advance } = mockAt()
    exhaust(mock)
    advance(RATE_LIMIT_WINDOW_MS)

    expect(mock.login({ code: syntheticCodes.available }).status).toBe(200)
  })

  it('keeps the old session while locked, even with consent to replace', () => {
    const { mock } = mockAt()
    mock.login({ code: syntheticCodes.available })
    const before = mock.session()
    exhaust(mock)

    expect(mock.login({ code: syntheticCodes.availableOther, replace_session: true }).status).toBe(429)
    expect(mock.session()).toEqual(before)
  })

  it('does not count conflicts and successes as failures', () => {
    const { mock } = mockAt()
    mock.login({ code: syntheticCodes.available })
    for (let i = 0; i < RATE_LIMIT_FAILURES; i++) mock.login({ code: syntheticCodes.availableOther })

    expect(mock.login({ code: syntheticCodes.available }).status).toBe(200)
  })
})

describe('code secrecy', () => {
  it('never echoes a code in any outcome', () => {
    const { mock } = mockAt()
    const outcomes = [
      ...Object.values(syntheticCodes).map((code) => mock.login({ code })),
      mock.login({ code: syntheticCodes.availableOther, replace_session: true }),
      mock.session(),
    ]
    const text = JSON.stringify(outcomes)

    for (const code of Object.values(syntheticCodes)) {
      expect(text).not.toContain(code)
      expect(text).not.toContain(normalizeCode(code))
    }
  })
})

describe('session handlers over MSW', () => {
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const
  let client: ReturnType<typeof createApiClient>
  let consoleSpies: ReturnType<typeof vi.spyOn>[] = []

  beforeEach(() => {
    client = createApiClient()
    accessMock.reset()
    consoleSpies = consoleMethods.map((method) => vi.spyOn(console, method))
  })

  afterEach(() => {
    accessMock.reset()
    vi.restoreAllMocks()
  })

  it('serves the session opened by a code login', async () => {
    expect((await client.GET('/api/v1/session')).data).toEqual({ principal: 'anonymous' })

    const login = await client.POST('/api/v1/auth/code', { body: { code: syntheticCodes.available } })
    expect(login.response.status).toBe(200)

    const { data } = await client.GET('/api/v1/session')
    expect(data).toEqual(login.data)
  })

  it('answers a conflict as problem+json and keeps the session', async () => {
    await client.POST('/api/v1/auth/code', { body: { code: syntheticCodes.available } })
    const { error, response } = await client.POST('/api/v1/auth/code', { body: { code: syntheticCodes.availableOther } })

    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(error).toMatchObject({ status: 409, code: 'session_conflict' })
    expect((await client.GET('/api/v1/session')).data).toMatchObject({ entitlement: { code_mask: 'F001' } })
  })

  it('sends Retry-After with the attempt limit', async () => {
    for (let i = 0; i < RATE_LIMIT_FAILURES; i++) {
      await client.POST('/api/v1/auth/code', { body: { code: syntheticCodes.unknown } })
    }
    const { error, response } = await client.POST('/api/v1/auth/code', { body: { code: syntheticCodes.available } })

    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(error).toMatchObject({ code: 'rate_limited' })
  })

  it('writes nothing to the console', async () => {
    for (const code of Object.values(syntheticCodes)) {
      accessMock.reset()
      await client.POST('/api/v1/auth/code', { body: { code } })
    }
    await client.GET('/api/v1/session')

    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })
})
