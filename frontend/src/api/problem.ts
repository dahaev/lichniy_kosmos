import type { components } from './schema'

export type ErrorCode = components['schemas']['ErrorCode']
export type ProblemBody = components['schemas']['Problem']

/** Client-side codes for failures that never reached a problem+json body. */
export type ClientErrorCode = 'network' | 'unexpected_response'

/**
 * A failed API call. UI branches on `code`, never on `status` or message text
 * (ARCHITECTURE_MVP_v2 §15.1).
 */
export class ApiProblem extends Error {
  readonly status: number
  readonly code: ErrorCode | ClientErrorCode
  readonly detail: string | undefined
  readonly requestId: string | undefined
  /** Validation messages by request field path, e.g. `birth_date` or `time.value`. */
  readonly fields: Readonly<Record<string, string>> | undefined

  constructor(
    status: number,
    code: ErrorCode | ClientErrorCode,
    detail?: string,
    requestId?: string,
    options?: ErrorOptions & { fields?: Record<string, string> | undefined },
  ) {
    super(detail ?? code, options)
    this.name = 'ApiProblem'
    this.status = status
    this.code = code
    this.detail = detail
    this.requestId = requestId
    this.fields = options?.fields
  }

  static fromResponse(status: number, body: unknown): ApiProblem {
    if (isProblemBody(body)) {
      return new ApiProblem(status, body.code, body.detail, body.request_id, { fields: body.fields })
    }
    return new ApiProblem(status, 'unexpected_response')
  }

  static network(cause: unknown): ApiProblem {
    return new ApiProblem(0, 'network', undefined, undefined, { cause })
  }
}

export function isProblemBody(body: unknown): body is ProblemBody {
  if (typeof body !== 'object' || body === null) return false
  const candidate = body as Record<string, unknown>
  return typeof candidate.code === 'string' && typeof candidate.status === 'number' && typeof candidate.title === 'string'
}
