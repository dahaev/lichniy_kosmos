import { describe, expect, it } from 'vitest'

import { ApiProblem } from '@/api/problem'

import { accessTexts, codeFailure, maskSpeech, maskText, parseRetryAfter } from './access'

describe('codeFailure (SCR-04 §0.5)', () => {
  it('puts format, validity and account binding at the field', () => {
    expect(codeFailure(new ApiProblem(422, 'code_malformed', 'Текст сервера.'))).toEqual({ kind: 'field', message: 'Текст сервера.' })
    expect(codeFailure(new ApiProblem(422, 'code_malformed'))).toEqual({ kind: 'field', message: accessTexts.malformed })
    expect(codeFailure(new ApiProblem(403, 'code_bound_to_account', 'Привязан.'))).toEqual({ kind: 'field', message: 'Привязан.' })
    expect(codeFailure(new ApiProblem(403, 'code_bound_to_account'))).toEqual({ kind: 'field', message: accessTexts.boundToAccount })
  })

  it('keeps one text for an invalid code whatever the server says', () => {
    expect(codeFailure(new ApiProblem(422, 'code_invalid', 'Заблокирован'))).toEqual({ kind: 'field', message: accessTexts.invalid })
  })

  it('asks before replacing a session', () => {
    expect(codeFailure(new ApiProblem(409, 'session_conflict', 'detail'))).toEqual({ kind: 'conflict' })
  })

  it('passes the rate limit text and wait through', () => {
    expect(codeFailure(new ApiProblem(429, 'rate_limited', 'Подожди.'), 60)).toEqual({ kind: 'limited', message: 'Подожди.', retryAfter: 60 })
    expect(codeFailure(new ApiProblem(429, 'rate_limited'))).toEqual({ kind: 'limited', message: accessTexts.rateLimited, retryAfter: null })
  })

  it.each([
    new ApiProblem(400, 'validation_failed', 'Запрос не разобран.'),
    new ApiProblem(503, 'internal_error', 'Сбой'),
    new ApiProblem(500, 'unexpected_response'),
    ApiProblem.network(new TypeError('fetch failed')),
  ])('reads %s as a failure to retry by hand', (problem) => {
    expect(codeFailure(problem)).toEqual({ kind: 'failed', message: accessTexts.failed })
  })
})

describe('parseRetryAfter', () => {
  it('accepts whole seconds only', () => {
    expect(parseRetryAfter('60')).toBe(60)
    expect(parseRetryAfter(' 5 ')).toBe(5)
    expect(parseRetryAfter('0')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull()
    expect(parseRetryAfter('-1')).toBeNull()
  })
})

describe('code mask', () => {
  it('shows four dots and the last four symbols, and spells them for a screen reader', () => {
    expect(maskText('7K2Q')).toBe('••••7K2Q')
    expect(maskSpeech('7K2Q')).toBe('код, оканчивающийся на 7 K 2 Q')
  })
})
