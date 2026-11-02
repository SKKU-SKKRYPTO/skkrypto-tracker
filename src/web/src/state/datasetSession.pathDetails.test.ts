import { describe, expect, it, vi } from 'vitest'
import { createDatasetSession } from './datasetSession'
import { adaptPathsResponse } from '../adapters/pathsAdapter'
import type { PathsResponse } from '../adapters/pathsAdapter'
import { adaptSelectedTraceResponse } from '../adapters/traceAdapter'
import detail from '../../mocks/v1/samples/dataset-detail.json'
import sample from '../../mocks/v1/samples/paths-success.json'
import traceSample from '../../mocks/v1/samples/trace-success.json'

const key = { datasetId: 'flow-demo', datasetVersion: 'v1' }
const response = adaptPathsResponse(sample, detail, key)
const conditions = { address: sample.meta.conditions.address, targetAddress: sample.meta.conditions.targetAddress, direction: 'outgoing' as const, maxDepth: 3 as const }
const first = sample.data.paths[0], second = sample.data.paths[1]
const e1 = first.transferIds[0], e2 = second.transferIds[0], shared = first.transferIds[2]
async function setup(incoming = false) {
  const paths = { searchPaths: vi.fn().mockResolvedValue(response) }
  const session = createDatasetSession({ paths, trace: { searchTrace: vi.fn().mockResolvedValue(adaptSelectedTraceResponse(traceSample, detail, key)) }, datasets: {
    listDatasets: vi.fn().mockResolvedValue({ ok: true, envelope: { ...detail, data: [detail.data] } }),
    getDataset: vi.fn().mockResolvedValue({ ok: true, envelope: detail }),
  } })
  await session.loadDatasets(); session.setMode('paths')
  if (incoming) {
    const body = structuredClone(sample)
    Object.assign(body.meta.conditions, { address: conditions.targetAddress, targetAddress: conditions.address, direction: 'incoming' })
    paths.searchPaths.mockResolvedValue(adaptPathsResponse(body, detail, key))
    session.setPathConditions({ ...conditions, address: conditions.targetAddress, targetAddress: conditions.address, direction: 'incoming' })
  } else session.setPathConditions(conditions)
  await session.searchPaths()
  return { session, paths }
}
describe('Path and individual-transfer selection policy', () => {
  it.each([false, true])('keeps a path for its evidence and clears only the path for other evidence (incoming=%s)', async incoming => {
    const { session } = await setup(incoming)
    session.selectPath(first.id); session.selectTransfer(e1)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: first.id, selectedTransferId: e1 })
    session.selectTransfer(e2)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: e2 })
  })
  it('preserves shared transfer selection when switching paths', async () => {
    const { session } = await setup()
    session.selectPath(first.id); session.selectTransfer(shared); session.selectPath(second.id)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: second.id, selectedTransferId: shared })
    session.selectPath(first.id)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: first.id, selectedTransferId: shared })
  })
  it('clears a transfer outside the newly selected path', async () => {
    const { session } = await setup()
    session.selectPath(first.id); session.selectTransfer(e1); session.selectPath(second.id)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: second.id, selectedTransferId: null })
  })
  it('keeps a transfer when clearing only the path or selecting a containing path later', async () => {
    const { session } = await setup()
    session.selectPath(first.id); session.selectTransfer(shared); session.selectPath(null)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: shared })
    session.selectPath(second.id)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: second.id, selectedTransferId: shared })
  })
  it('ignores unknown IDs without displaying an unrelated transfer or changing valid selection', async () => {
    const { session } = await setup()
    session.selectPath(first.id); session.selectTransfer(e1)
    session.selectTransfer('missing'); session.selectPath('missing')
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: first.id, selectedTransferId: e1 })
  })
  it.each(['address', 'targetAddress', 'direction', 'maxDepth', 'dataset', 'mode', 'cancel', 'cleanup', 'new-search'] as const)('clears both selections on %s', async change => {
    const { session, paths } = await setup()
    session.selectPath(first.id); session.selectTransfer(shared)
    if (change === 'dataset') await session.selectDataset({ ...key, datasetVersion: 'v2' })
    else if (change === 'mode') session.setMode('trace')
    else if (change === 'cancel') session.cancelSearch()
    else if (change === 'cleanup') session.cancelPending()
    else if (change === 'new-search') {
      let resolve!: (value: PathsResponse) => void
      paths.searchPaths.mockImplementationOnce(() => new Promise<PathsResponse>(yes => { resolve = yes }))
      const pending = session.searchPaths()
      session.selectTransfer(shared)
      expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: null, isSearching: true })
      session.cancelSearch(); resolve(response); await pending
    } else session.setPathConditions({ ...conditions, [change]: change === 'maxDepth' ? 2 : change === 'direction' ? 'incoming' : `0x${'a'.repeat(40)}` })
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: null })
  })
  it('does not restore selections on a late response or an invalid response', async () => {
    const { session, paths } = await setup()
    let resolve!: (value: PathsResponse) => void
    paths.searchPaths.mockImplementationOnce(() => new Promise<PathsResponse>(yes => { resolve = yes }))
    session.selectPath(first.id); session.selectTransfer(e1)
    const pending = session.searchPaths(); session.setMode('trace'); resolve(response); await pending
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: null, pathResponse: null })
    session.setMode('paths')
    const invalid = structuredClone(sample); invalid.data.paths[0].transferIds[0] = 'missing'
    paths.searchPaths.mockResolvedValueOnce(adaptPathsResponse(invalid, detail, key)); await session.searchPaths()
    session.selectTransfer(e1); session.selectPath(first.id)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: null, pathResponse: { ok: false } })
  })
  it('keeps Trace table/graph selection independent after returning from Path', async () => {
    const { session } = await setup()
    session.selectPath(first.id); session.selectTransfer(e1); session.setMode('trace'); await session.search(conditions.address)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: null })
    session.selectTransfer(traceSample.data.transfers[1].id)
    expect(session.getSnapshot()).toMatchObject({ selectedPathId: null, selectedTransferId: traceSample.data.transfers[1].id })
  })
})
