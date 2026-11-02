import { describe, expect, it, vi } from 'vitest'
import { createDatasetSession } from './datasetSession'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PathsResponse } from '../adapters/pathsAdapter'
import { adaptSelectedTraceResponse } from '../adapters/traceAdapter'
import { SearchRequestError } from '../api/searchFailure'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import normal from '../../mocks/v1/samples/paths-success.json'
import traceSample from '../../mocks/v1/samples/trace-success.json'

const selection = { datasetId: 'flow-demo', datasetVersion: 'v1' }
const response = adaptPathsResponse(normal, detail, selection)
const conditions = { address: normal.meta.conditions.address, targetAddress: normal.meta.conditions.targetAddress, direction: 'outgoing' as const, maxDepth: 3 as const }
async function setup() {
  const paths = { searchPaths: vi.fn().mockResolvedValue(response) }
  const session = createDatasetSession({ paths, trace: { searchTrace: vi.fn().mockResolvedValue(adaptSelectedTraceResponse(traceSample, detail, selection)) }, datasets: {
    listDatasets: vi.fn().mockResolvedValue({ ok: true, envelope: { ...detail, data: [detail.data] } }),
    getDataset: vi.fn().mockResolvedValue({ ok: true, envelope: detail }),
  } })
  await session.loadDatasets(); session.setMode('paths'); session.setPathConditions(conditions); await session.searchPaths()
  return { session, paths }
}
describe('Path selection lifecycle', () => {
  it('selects and switches paths independently of the single-transfer ID', async () => {
    const { session } = await setup()
    expect(session.getSnapshot().selectedPathId).toBeNull()
    for (const path of normal.data.paths) {
      session.selectPath(path.id)
      expect(session.getSnapshot()).toMatchObject({ selectedPathId: path.id, selectedTransferId: null })
      session.selectTransfer(path.transferIds[0])
      expect(session.getSnapshot()).toMatchObject({ selectedPathId: path.id, selectedTransferId: path.transferIds[0] })
    }
    session.selectPath('missing')
    expect(session.getSnapshot().selectedPathId).toBe(normal.data.paths[1].id)
    session.selectPath(null)
    expect(session.getSnapshot().selectedPathId).toBeNull()
  })
  it.each(['address', 'target', 'direction', 'depth', 'dataset', 'version', 'mode', 'cancel', 'cleanup', 'new-search'] as const)('clears selection immediately on %s', async change => {
    const { session, paths } = await setup(); session.selectPath(normal.data.paths[0].id)
    if (change === 'dataset' || change === 'version') await session.selectDataset({ ...selection, [change === 'dataset' ? 'datasetId' : 'datasetVersion']: 'other' })
    else if (change === 'mode') session.setMode('trace')
    else if (change === 'cancel') session.cancelSearch()
    else if (change === 'cleanup') session.cancelPending()
    else if (change === 'new-search') {
      let resolve!: (value: PathsResponse) => void
      paths.searchPaths.mockImplementationOnce(() => new Promise<PathsResponse>(yes => { resolve = yes }))
      const pending = session.searchPaths()
      expect(session.getSnapshot().selectedPathId).toBeNull()
      session.selectPath(normal.data.paths[0].id)
      expect(session.getSnapshot().selectedPathId).toBeNull()
      resolve(response); await pending
    } else session.setPathConditions({ ...conditions, ...(change === 'direction' ? { direction: 'incoming' } : change === 'depth' ? { maxDepth: 2 } : change === 'address' ? { address: '0x123' } : { targetAddress: '0x123' }) })
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: null })
  })
  it('does not resurrect selection after a cancelled old request resolves', async () => {
    const { session, paths } = await setup()
    let resolve!: (value: PathsResponse) => void
    paths.searchPaths.mockImplementationOnce(() => new Promise<PathsResponse>(yes => { resolve = yes }))
    const pending = session.searchPaths(); session.cancelSearch()
    resolve(response); await pending
    session.selectPath(normal.data.paths[0].id)
    expect(session.getSnapshot()).toMatchObject({ pathResponse: null, selectedPathId: null })
  })
  it('keeps selection empty after format/network failures and in empty results', async () => {
    const { session, paths } = await setup()
    session.selectPath(normal.data.paths[0].id)
    paths.searchPaths.mockRejectedValueOnce(new SearchRequestError('network')); await session.searchPaths()
    expect(session.getSnapshot().selectedPathId).toBeNull()
    paths.searchPaths.mockResolvedValueOnce({ ok: false, kind: 'invalid-response', error: { message: 'invalid' } }); await session.searchPaths()
    session.selectPath(normal.data.paths[0].id); expect(session.getSnapshot().selectedPathId).toBeNull()
    const empty = structuredClone(normal); empty.data.paths = []; empty.data.transfers = []; empty.data.nodes = []; empty.data.limits.found = 0; empty.meta.limits.found = 0
    paths.searchPaths.mockResolvedValueOnce(adaptPathsResponse(empty, detail, selection)); await session.searchPaths()
    session.selectPath(normal.data.paths[0].id); expect(session.getSnapshot().selectedPathId).toBeNull()
  })
  it('keeps Trace single-transfer selection unchanged after switching modes', async () => {
    const { session } = await setup(); session.selectPath(normal.data.paths[0].id); session.setMode('trace')
    await session.search(traceSample.meta.conditions.address)
    session.selectTransfer(traceSample.data.transfers[0].id)
    session.selectPath(normal.data.paths[0].id)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: traceSample.data.transfers[0].id })
  })
})
