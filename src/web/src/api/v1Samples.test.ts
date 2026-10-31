/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import spec from '../../mocks/v1/openapi.json'
import manifest from '../../mocks/v1/sample-requests.json'
import { matchesResponse, matchesV1 } from './validateV1'
import { adaptTraceResponse } from '../adapters/traceAdapter'
const samples = new URL('../../mocks/v1/samples/', import.meta.url)
const official = new URL('../../../backend/api-server/contracts/', import.meta.url)
describe('official v1 contract and samples', () => {
  it('copies exactly 20 samples and the contract unchanged', () => {
    expect(JSON.parse(readFileSync(new URL('openapi.json', official), 'utf8'))).toEqual(spec)
    expect(JSON.parse(readFileSync(new URL('sample-requests.json', official), 'utf8'))).toEqual(manifest)
    const files = readdirSync(samples).filter(name => name.endsWith('.json')).sort()
    expect(files).toHaveLength(20)
    expect(files).toEqual(manifest.map(entry => entry.sample).sort())
    for (const file of files) expect(readFileSync(new URL(file, samples), 'utf8')).toBe(readFileSync(new URL(`samples/${file}`, official), 'utf8'))
  })
  it.each(manifest)('$sample matches the $status schema for $method $path', entry => {
    const body = JSON.parse(readFileSync(new URL(entry.sample, samples), 'utf8'))
    const path = entry.path.split('?')[0].replace(/\/api\/datasets\/[^/]+$/, '/api/datasets/{id}').replace(/\/api\/transactions\/[^/]+$/, '/api/transactions/{txHash}')
    expect(matchesResponse(body, entry.method, path, entry.status)).toBe(true)
    if (entry.status !== 200) expect(adaptTraceResponse(body, null, entry.status)).toMatchObject({ kind: 'api', status: entry.status, error: body.error })
  })
  it('keeps separate IDs for logs in the same transaction', () => {
    const body = JSON.parse(readFileSync(new URL('transaction-multiple.json', samples), 'utf8'))
    expect(body.data[0].txHash).toBe(body.data[1].txHash)
    expect(body.data[0].id).not.toBe(body.data[1].id)
    expect(body.data[0].logIndex).not.toBe(body.data[1].logIndex)
  })
  it('rejects missing required fields and invalid values', () => {
    expect(matchesV1({ chainId: 84532, tokenAddress: '0x123', symbol: 'SKK', decimals: 2 }, 'Asset')).toBe(false)
    expect(matchesV1({ chainId: 84532, decimals: 2 }, 'Asset')).toBe(false)
    expect(matchesV1({ contractVersion: 'v2', ruleVersion: 'flow-v1', limitations: [] }, 'Meta')).toBe(false)
  })
})

