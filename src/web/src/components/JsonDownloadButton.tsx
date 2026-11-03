import { useRef, useState } from 'react'
import type { DatasetSession } from '../state/datasetSession'
import { downloadJson } from '../jsonExport'

type Props = { session: Pick<DatasetSession, 'getDownloadEnvelope' | 'getSnapshot'> }
export default function JsonDownloadButton({ session }: Props) {
  const envelope = session.getDownloadEnvelope()
  const busy = useRef(false)
  const [preparing, setPreparing] = useState(false)
  const [failure, setFailure] = useState<{ envelope: typeof envelope; message: string } | null>(null)

  async function download() {
    if (busy.current) return
    // A previously enabled button may be clicked after inputs/mode changed.
    const current = session.getDownloadEnvelope()
    if (!current) return
    const mode = session.getSnapshot().mode
    busy.current = true
    setPreparing(true)
    setFailure(null)
    try {
      await downloadJson(mode, current)
    } catch {
      setFailure({ envelope: current, message: 'JSON 다운로드를 준비하지 못했습니다. 다시 시도해 주세요.' })
    } finally {
      busy.current = false
      setPreparing(false)
    }
  }

  return <>
    <div className="search-bar">
      <button type="button" disabled={!envelope || preparing} aria-busy={preparing} onClick={() => { void download() }}>검색 결과 JSON 다운로드</button>
    </div>
    {failure && failure.envelope === envelope && <p className="notice notice-error" role="alert">{failure.message}</p>}
  </>
}
