import { useCallback, useEffect, useRef, useState } from 'react'

import { data } from '@/data'
import type { SessionSnapshot } from '@/data/types'
import { startSessionSnapshotPolling } from '@/lib/session-refresh'

interface State {
  snapshot: SessionSnapshot | null
  loading: boolean
  /** 세션 자체가 없을 때. 잘못된 링크와 로딩 중을 구분한다. */
  notFound: boolean
  error: string | null
}

/**
 * 세션의 전체 상태를 읽고 realtime 변경마다 다시 읽는다.
 * 한 교실 규모(모둠 10개 안팎)에서는 부분 병합보다 전체 재조회가 어긋날 여지가 적다.
 */
export function useSessionSnapshot(
  sessionId: string | undefined,
  options: { pollingEnabled?: boolean } = {},
) {
  const { pollingEnabled = false } = options
  const [state, setState] = useState<State>({
    snapshot: null,
    loading: true,
    notFound: false,
    error: null,
  })
  const pendingRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    if (!sessionId) return
    try {
      const snapshot = await data().getSessionSnapshot(sessionId)
      setState({
        snapshot,
        loading: false,
        notFound: snapshot === null,
        error: null,
      })
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '상태를 불러오지 못했습니다.',
      }))
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      setState({ snapshot: null, loading: false, notFound: true, error: null })
      return
    }

    setState({ snapshot: null, loading: true, notFound: false, error: null })
    void load()

    const scheduleReload = () => {
      if (pendingRef.current !== null) return
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null
        void load()
      }, 200)
    }

    const unsubscribe = data().subscribeSession(sessionId, scheduleReload)
    const stopPolling = pollingEnabled
      ? startSessionSnapshotPolling(scheduleReload)
      : undefined
    return () => {
      unsubscribe()
      stopPolling?.()
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current)
      pendingRef.current = null
    }
  }, [sessionId, load, pollingEnabled])

  return { ...state, refresh: load }
}
