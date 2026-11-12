import { createApiClient, type ApiClient } from '@/api/client'
import { ApiProblem } from '@/api/problem'
import type { components } from '@/api/schema'

// SCR-04: the code branch of access (GET /api/v1/session, POST
// /api/v1/auth/code, SCR-04 §0.3). The code the visitor typed lives in the
// view's memory only: it is never stored, logged or put in a URL, and no
// function here keeps or returns it.

export type Session = components['schemas']['Session']
export type CodeSession = components['schemas']['CodeSession']

export const accessTexts = {
  empty: 'Введи код с карточки.',
  malformed: 'Код не распознан. Проверь, что он введён полностью. Если код получен до запуска нового сайта, напиши в поддержку.',
  invalid: 'Этот код не подходит. Проверь, что он введён полностью, или напиши в поддержку.',
  boundToAccount: 'Этот код уже привязан к личному кабинету, поэтому его нельзя ввести здесь.',
  rateLimited: 'Слишком много попыток. Подожди немного и попробуй снова.',
  failed: 'Не удалось проверить код. Проверь соединение и попробуй ещё раз.',
} as const

export type CodeFailure =
  | { kind: 'field'; message: string }
  | { kind: 'conflict' }
  | { kind: 'limited'; message: string; retryAfter: number | null }
  | { kind: 'failed'; message: string }

/**
 * What the screen does with a refused code (SCR-04 §0.5). Branches on the
 * problem code only; `code_invalid` keeps one text whatever the server says.
 */
export function codeFailure(problem: ApiProblem, retryAfter: number | null = null): CodeFailure {
  switch (problem.code) {
    case 'code_malformed':
      return { kind: 'field', message: problem.detail ?? accessTexts.malformed }
    case 'code_invalid':
      return { kind: 'field', message: accessTexts.invalid }
    case 'code_bound_to_account':
      return { kind: 'field', message: problem.detail ?? accessTexts.boundToAccount }
    case 'session_conflict':
      return { kind: 'conflict' }
    case 'rate_limited':
      return { kind: 'limited', message: problem.detail ?? accessTexts.rateLimited, retryAfter }
    default:
      return { kind: 'failed', message: accessTexts.failed }
  }
}

/** `Retry-After` in whole seconds; an HTTP date or garbage gives null. */
export function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null
  const seconds = Number(header.trim())
  return seconds > 0 ? seconds : null
}

/** «••••7K2Q»: the mask as the screen shows it. */
export function maskText(mask: string): string {
  return `••••${mask}`
}

/** How a screen reader says the mask: «код, оканчивающийся на 7 K 2 Q». */
export function maskSpeech(mask: string): string {
  return `код, оканчивающийся на ${mask.split('').join(' ')}`
}

export class CodeRefused extends Error {
  readonly failure: CodeFailure

  constructor(failure: CodeFailure, options?: ErrorOptions) {
    super(failure.kind, options)
    this.name = 'CodeRefused'
    this.failure = failure
  }
}

/** GET /api/v1/session; any failure reads as no session (SCR-04 §0.5). */
export async function fetchSession(signal: AbortSignal, client: ApiClient = createApiClient()): Promise<Session | null> {
  try {
    const { data } = await client.GET('/api/v1/session', { signal })
    return data ?? null
  } catch {
    return null
  }
}

/**
 * POST /api/v1/auth/code. `replace` is sent only after the visitor chose to
 * close the current code (А8); otherwise the field is left out.
 */
export async function startCodeSession(
  code: string,
  replace: boolean,
  signal: AbortSignal,
  client: ApiClient = createApiClient(),
): Promise<CodeSession> {
  let result
  try {
    result = await client.POST('/api/v1/auth/code', { body: replace ? { code, replace_session: true } : { code }, signal })
  } catch (cause) {
    if (signal.aborted) throw cause
    throw new CodeRefused(codeFailure(ApiProblem.network(cause)))
  }
  const { data, error, response } = result
  if (data) return data
  const problem = ApiProblem.fromResponse(response.status, error)
  throw new CodeRefused(codeFailure(problem, parseRetryAfter(response.headers.get('retry-after'))))
}
