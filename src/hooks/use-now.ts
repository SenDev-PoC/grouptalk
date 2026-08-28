import { useEffect, useState } from 'react'

/** 경과 시간과 정보 최신성 판정을 주기적으로 다시 계산하기 위한 시계. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}
