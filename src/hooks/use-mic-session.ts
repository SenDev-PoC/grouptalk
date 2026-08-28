import { Room, RoomEvent, type LocalAudioTrack } from 'livekit-client'
import { useCallback, useEffect, useRef, useState } from 'react'

import { data } from '@/data'
import { requestLiveKitGrant } from '@/lib/livekit-token'

export type MicPhase = 'idle' | 'connecting' | 'listening' | 'speaking' | 'muted' | 'error'

interface UseMicSessionOptions {
  sessionId: string
  groupId: string
  groupName: string
  /** 활동이 진행 중일 때만 마이크를 켠다. */
  enabled: boolean
}

interface MicSession {
  phase: MicPhase
  level: number
  muted: boolean
  /** LiveKit 연결 실패 후 마이크만 동작할 때. 교사 화면과 상태를 맞추기 위해 노출한다. */
  localOnly: boolean
  error: string | null
  toggleMute: () => void
  reconnect: () => void
}

const SPEAKING_THRESHOLD = 0.055
const HEARTBEAT_MS = 8000

export function useMicSession({
  sessionId,
  groupId,
  groupName,
  enabled,
}: UseMicSessionOptions): MicSession {
  const [phase, setPhase] = useState<MicPhase>('idle')
  const [level, setLevel] = useState(0)
  const [muted, setMuted] = useState(false)
  const [localOnly, setLocalOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const roomRef = useRef<Room | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const frameRef = useRef<number | null>(null)
  const mutedRef = useRef(false)

  const startMeter = useCallback((stream: MediaStream) => {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return

    const context = new AudioContextCtor()
    audioContextRef.current = context
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)

    const buffer = new Float32Array(analyser.fftSize)
    const tick = () => {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (const sample of buffer) sum += sample * sample
      const rms = Math.sqrt(sum / buffer.length)
      const next = mutedRef.current ? 0 : Math.min(1, rms * 6)
      setLevel(next)
      setPhase((prev) => {
        if (prev === 'error' || prev === 'connecting' || prev === 'idle') return prev
        if (mutedRef.current) return 'muted'
        return next > SPEAKING_THRESHOLD ? 'speaking' : 'listening'
      })
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    mutedRef.current = muted
    const track = roomRef.current?.localParticipant.audioTrackPublications
      .values()
      .next().value?.track as LocalAudioTrack | undefined
    if (track) void (muted ? track.mute() : track.unmute())
    for (const audioTrack of streamRef.current?.getAudioTracks() ?? []) {
      audioTrack.enabled = !muted
    }
    setPhase((prev) => (prev === 'listening' || prev === 'speaking' || prev === 'muted'
      ? muted
        ? 'muted'
        : 'listening'
      : prev))
  }, [muted])

  useEffect(() => {
    if (!enabled) {
      setPhase('idle')
      return
    }

    let cancelled = false

    async function connect() {
      setPhase('connecting')
      setError(null)
      setLocalOnly(false)

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch {
        if (cancelled) return
        setPhase('error')
        setError('마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해 주세요.')
        void data().reportGroupPresence(groupId, 'lost').catch(() => {})
        return
      }

      if (cancelled) {
        for (const track of stream.getTracks()) track.stop()
        return
      }

      streamRef.current = stream
      startMeter(stream)

      const grant = await requestLiveKitGrant({ sessionId, groupId, groupName })
      if (cancelled) return

      if (!grant) {
        // 토큰 서버가 아직 없어도 학생은 자기 상태를 볼 수 있어야 한다.
        setLocalOnly(true)
        setPhase(mutedRef.current ? 'muted' : 'listening')
        void data().reportGroupPresence(groupId, 'live').catch(() => {})
        return
      }

      const room = new Room({ adaptiveStream: false, dynacast: false })
      roomRef.current = room
      room
        .on(RoomEvent.Disconnected, () => {
          if (cancelled) return
          setPhase('error')
          setError('연결이 끊어졌습니다. 다시 연결해 주세요.')
          void data().reportGroupPresence(groupId, 'lost').catch(() => {})
        })
        .on(RoomEvent.Reconnecting, () => !cancelled && setPhase('connecting'))
        .on(RoomEvent.Reconnected, () => !cancelled && setPhase('listening'))

      try {
        await room.connect(grant.url, grant.token)
        if (cancelled) return
        const [audioTrack] = stream.getAudioTracks()
        if (audioTrack) await room.localParticipant.publishTrack(audioTrack)
        setPhase(mutedRef.current ? 'muted' : 'listening')
        void data().reportGroupPresence(groupId, 'live').catch(() => {})
      } catch {
        if (cancelled) return
        setLocalOnly(true)
        setPhase(mutedRef.current ? 'muted' : 'listening')
        setError('음성 서버에 연결하지 못했습니다. 대화는 기록되지 않을 수 있습니다.')
        void data().reportGroupPresence(groupId, 'lost').catch(() => {})
      }
    }

    void connect()

    return () => {
      cancelled = true
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      void audioContextRef.current?.close().catch(() => {})
      audioContextRef.current = null
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      streamRef.current = null
      void roomRef.current?.disconnect()
      roomRef.current = null
    }
  }, [enabled, sessionId, groupId, groupName, attempt, startMeter])

  // 교사 화면이 오래된 상태를 현재 상태처럼 보여주지 않도록 주기적으로 살아있음을 알린다.
  useEffect(() => {
    if (!enabled) return
    const isConnected = phase === 'listening' || phase === 'speaking' || phase === 'muted'
    if (!isConnected) return

    const timer = window.setInterval(() => {
      void data().reportGroupPresence(groupId, 'live').catch(() => {})
    }, HEARTBEAT_MS)
    return () => window.clearInterval(timer)
  }, [enabled, groupId, phase])

  return {
    phase,
    level,
    muted,
    localOnly,
    error,
    toggleMute: () => setMuted((prev) => !prev),
    reconnect: () => setAttempt((prev) => prev + 1),
  }
}
