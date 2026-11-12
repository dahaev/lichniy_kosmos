import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { canonicalJSON, CHECK_KEY, CHECK_TTL_MS, isCheckedProfile, parseCheck, profileFingerprint, recordCheck } from './checkStamp'
import { DRAFT_KEY, DRAFT_TTL_MS, useIntakeDraft } from './draft'
import type { Profile } from './review'

const profile: Profile = {
  name: 'Тестовая Вега',
  birth_date: '1990-03-12',
  place_id: 'ru-kzn',
  time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 },
}

const NOW = Date.UTC(2026, 10, 12, 12)

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
})

describe('profile fingerprint (SCR-04 §0.4)', () => {
  it('does not depend on key order', async () => {
    const shuffled = { time: { accuracy_minutes: 0, source: 'document', value: '14:30', kind: 'known' }, place_id: 'ru-kzn', birth_date: '1990-03-12', name: 'Тестовая Вега' } as const
    expect(canonicalJSON(shuffled)).toBe(canonicalJSON(profile))
    expect(await profileFingerprint(shuffled)).toBe(await profileFingerprint(profile))
  })

  it('is a SHA-256 hex that changes with any answer', async () => {
    const base = await profileFingerprint(profile)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    const variants: Profile[] = [
      { ...profile, name: 'Тестовая Лира' },
      { ...profile, birth_date: '1990-03-13' },
      { ...profile, place_id: 'ru-msk' },
      { ...profile, time: { kind: 'known', value: '14:31', source: 'document', accuracy_minutes: 0 } },
      { ...profile, time: { kind: 'known', value: '14:30', source: 'family', accuracy_minutes: 0 } },
      { ...profile, time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 15 } },
      { ...profile, time: { kind: 'unknown' } },
    ]
    for (const variant of variants) expect(await profileFingerprint(variant)).not.toBe(base)
  })

  it('stores the version, the fingerprint and the time, never the answers', async () => {
    await recordCheck(profile, NOW)
    const raw = sessionStorage.getItem(CHECK_KEY) ?? ''
    expect(JSON.parse(raw)).toEqual({ version: 1, fingerprint: await profileFingerprint(profile), checkedAt: NOW })
    expect(raw).not.toContain('Вега')
    expect(raw).not.toContain('1990')
    expect(raw).not.toContain('ru-kzn')
  })

  it('matches only the profile that was checked', async () => {
    await recordCheck(profile, NOW)
    expect(await isCheckedProfile(profile, NOW)).toBe(true)
    expect(await isCheckedProfile({ ...profile, name: 'Тестовая Лира' }, NOW)).toBe(false)
  })

  it('expires with the draft and drops a stale entry', async () => {
    expect(CHECK_TTL_MS).toBe(DRAFT_TTL_MS)
    await recordCheck(profile, NOW)
    expect(await isCheckedProfile(profile, NOW + CHECK_TTL_MS)).toBe(true)
    expect(await isCheckedProfile(profile, NOW + CHECK_TTL_MS + 1)).toBe(false)
    expect(sessionStorage.getItem(CHECK_KEY)).toBeNull()
  })

  it('rejects foreign and damaged entries', () => {
    const fingerprint = 'a'.repeat(64)
    expect(parseCheck(null, NOW)).toBeNull()
    expect(parseCheck('{', NOW)).toBeNull()
    expect(parseCheck(JSON.stringify({ version: 2, fingerprint, checkedAt: NOW }), NOW)).toBeNull()
    expect(parseCheck(JSON.stringify({ version: 1, fingerprint: 'nope', checkedAt: NOW }), NOW)).toBeNull()
    expect(parseCheck(JSON.stringify({ version: 1, fingerprint, checkedAt: NOW + 120_000 }), NOW)).toBeNull()
    expect(parseCheck(JSON.stringify({ version: 1, fingerprint, checkedAt: NOW }), NOW)).toBe(fingerprint)
  })

  it('is cleared by a draft reset', async () => {
    await recordCheck(profile)
    useIntakeDraft().reset()
    expect(sessionStorage.getItem(CHECK_KEY)).toBeNull()
  })

  it('is cleared when the tab has no live draft to belong to', async () => {
    await recordCheck(profile)
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, updatedAt: Date.now() - DRAFT_TTL_MS - 1 }))
    useIntakeDraft()
    expect(sessionStorage.getItem(CHECK_KEY)).toBeNull()
  })
})
