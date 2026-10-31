import { describe, expect, it } from 'vitest'
import { SearchRequestError, searchFailure } from './searchFailure'
describe('request failure classification', () => {
  it.each(['network', 'response-read'] as const)('keeps %s separate from API and JSON errors', stage => {
    const result = searchFailure(new SearchRequestError(stage))
    expect(result).toMatchObject({ ok: false, kind: 'request-failed', stage })
    expect(result.error.message).toContain(stage === 'network' ? '네트워크' : '응답을 끝까지 읽지 못')
  })
  it.each([new TypeError('private detail'), new Error('private detail'), null, 'private detail'])('handles unclassified rejected promises without leaking internals', cause => {
    const result = searchFailure(cause)
    expect(result).toMatchObject({ kind: 'request-failed', stage: 'unknown' })
    expect(result.error.message).not.toContain('private detail')
  })
})
