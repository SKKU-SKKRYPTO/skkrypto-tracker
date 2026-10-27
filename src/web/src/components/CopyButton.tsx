import { useEffect, useState } from 'react'

type Props = {
  value: string
  label: string
}

type Status = 'idle' | 'copied' | 'failed'

const MESSAGE: Record<Status, string> = {
  idle: '복사',
  copied: '복사됨',
  failed: '복사 실패',
}

function CopyButton({ value, label }: Props) {
  const [status, setStatus] = useState<Status>('idle')

  // "복사됨" / "복사 실패"는 잠깐 보여준 뒤 원래대로 돌린다
  useEffect(() => {
    if (status === 'idle') return
    const timer = setTimeout(() => setStatus('idle'), 1500)
    return () => clearTimeout(timer)
  }, [status])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <button
      type="button"
      className="copy-button"
      aria-label={`${label} 복사`}
      onClick={copy}
    >
      <span aria-live="polite">{MESSAGE[status]}</span>
    </button>
  )
}

export default CopyButton
