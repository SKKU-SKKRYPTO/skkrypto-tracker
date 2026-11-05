import { describe, expect, it, vi } from 'vitest'
import { decodePracticeProblems, loadPracticeProblems, practiceDatasetKey, practiceProblemsUrl } from './practiceProblems'
import { A, E, S, testProblemsFile } from './practiceTestProblems'

const reply = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
describe('practice problems file', () => {
  it('reads the runtime problems file without hardcoding problems in the web code', () => {
    const problems = decodePracticeProblems(testProblemsFile)
    expect(problems.map(problem => problem.id)).toEqual(['T1', 'T2'])
    expect(problems[0]).toMatchObject({ datasetId: 'flow-demo', datasetVersion: 'v1', startAddress: S, targetAddress: E, viaAddress: A, maxDepth: 2 })
    expect(problems[1]).not.toHaveProperty('viaAddress')
    expect(problems[1].hints).toHaveLength(2)
    expect(practiceDatasetKey(problems[1])).toBe('["patterns-demo","v1"]')
  })
  it('rejects malformed problems instead of guessing', () => {
    const base = testProblemsFile.problems[0]
    const broken = [
      { ...testProblemsFile, version: 1 },
      { version: 2, problems: [] },
      { version: 2, problems: [base, base] },
      { version: 2, problems: [{ ...base, prompt: [] }] },
      { version: 2, problems: [{ ...base, targetAddress: 'T' }] },
      { version: 2, problems: [{ ...base, targetAddress: S }] },
      { version: 2, problems: [{ ...base, viaAddress: '0x02' }] },
      { version: 2, problems: [{ ...base, maxDepth: 4 }] },
      { version: 2, problems: [{ ...base, datasetId: '' }] },
      { version: 2, problems: [{ ...base, hints: ['그냥 문장'] }] },
    ]
    for (const value of broken) expect(() => decodePracticeProblems(value)).toThrow('실습 문제 파일')
  })
  it('uses the configured URL or practice/problems.json under the app base', () => {
    expect(practiceProblemsUrl({ BASE_URL: '/' })).toBe('/practice/problems.json')
    expect(practiceProblemsUrl({ BASE_URL: '/app' })).toBe('/app/practice/problems.json')
    expect(practiceProblemsUrl({ BASE_URL: '/', VITE_PRACTICE_PROBLEMS_URL: ' https://example.test/p.json ' })).toBe('https://example.test/p.json')
  })
  it('treats a missing file or an HTML fallback page as "not published yet"', async () => {
    const missing = vi.fn<typeof fetch>().mockResolvedValue(reply(404, '{}'))
    expect(await loadPracticeProblems('/practice/problems.json', missing)).toEqual({ status: 'unavailable' })
    expect(missing).toHaveBeenCalledWith('/practice/problems.json', expect.objectContaining({ cache: 'no-store' }))
    const html = vi.fn<typeof fetch>().mockResolvedValue(new Response('<!doctype html>', { status: 200 }))
    expect(await loadPracticeProblems('/x', html)).toEqual({ status: 'unavailable' })
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(reply(200, JSON.stringify({ version: 2, problems: [{ id: 'x' }] })))
    expect((await loadPracticeProblems('/x', invalid)).status).toBe('invalid')
    const ready = vi.fn<typeof fetch>().mockResolvedValue(reply(200, JSON.stringify(testProblemsFile)))
    const loaded = await loadPracticeProblems('/x', ready)
    expect(loaded.status === 'ready' && loaded.problems.length).toBe(2)
  })
  it('reports network and server failures and broken JSON instead of "not published yet"', async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    expect(await loadPracticeProblems('/x', offline)).toMatchObject({ status: 'failed', message: expect.stringContaining('불러오지 못했습니다') })
    const down = vi.fn<typeof fetch>().mockResolvedValue(reply(500, '{}'))
    expect(await loadPracticeProblems('/x', down)).toMatchObject({ status: 'failed', message: expect.stringContaining('HTTP 500') })
    const broken = vi.fn<typeof fetch>().mockResolvedValue(reply(200, '{"version": 3, "problems": ['))
    expect(await loadPracticeProblems('/x', broken)).toMatchObject({ status: 'invalid', message: expect.stringContaining('JSON이 아닙니다') })
  })
})
