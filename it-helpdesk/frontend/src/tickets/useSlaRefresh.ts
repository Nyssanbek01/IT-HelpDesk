import { useEffect, useState } from 'react'
export function useSlaRefresh() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setRevision((value) => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return revision
}
