import type { AnalysisResult, SuccessEnvelope } from './api/v1Types'
import type { AnalysisMode } from './state/datasetSession'

type Envelope = SuccessEnvelope<AnalysisResult>

function filenamePart(value: string): string {
  // Allow only portable filename characters, including for Windows downloads.
  return value.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)
}

export function buildJsonFilename(mode: AnalysisMode, envelope: Envelope, downloadedAt: Date): string {
  const { datasetId, datasetVersion } = envelope.meta
  if (!datasetId || !datasetVersion) throw new Error('Missing response dataset identity')
  const timestamp = downloadedAt.toISOString().replace(/[-:.]/g, '')
  return `skkrypto-${mode}-${filenamePart(datasetId)}-${filenamePart(datasetVersion)}-${timestamp}.json`
}

// Call only with an accepted envelope from getDownloadEnvelope; no UI fields or wrappers.
export function createJsonFile(mode: AnalysisMode, envelope: Envelope, downloadedAt = new Date()) {
  const filename = buildJsonFilename(mode, envelope, downloadedAt)
  const text = JSON.stringify(envelope, null, 2)
  return { filename, blob: new Blob([text + '\n'], { type: 'application/json;charset=utf-8' }) }
}

export async function downloadJson(mode: AnalysisMode, envelope: Envelope, downloadedAt = new Date()): Promise<void> {
  const { filename, blob } = createJsonFile(mode, envelope, downloadedAt)
  let url: string | undefined
  let anchor: HTMLAnchorElement | undefined
  try {
    url = URL.createObjectURL(blob)
    anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.hidden = true
    document.body.appendChild(anchor)
    anchor.click()
    // Keep the URL alive briefly so the browser can consume the download navigation.
    // This is preparation cleanup, not confirmation that the file was saved to disk.
    await new Promise<void>(resolve => setTimeout(resolve, 1000))
  } finally {
    try { anchor?.remove() } finally {
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }
}
