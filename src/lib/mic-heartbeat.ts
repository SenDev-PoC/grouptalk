export type MicPhase = 'idle' | 'connecting' | 'listening' | 'speaking' | 'muted' | 'error'

export const GROUP_PRESENCE_HEARTBEAT_MS = 8_000

interface HeartbeatScheduler {
  setInterval(callback: () => void, delay: number): number
  clearInterval(handle: number): void
}

/** 마이크 표시 상태가 바뀌어도 LiveKit 연결 자체는 유지되는 상태들이다. */
export function isMicPresenceConnected(phase: MicPhase): boolean {
  return phase === 'listening' || phase === 'speaking' || phase === 'muted'
}

/** 연결 직후 한 번 보고하고, 이후 같은 연결이 유지되는 동안 주기적으로 보고한다. */
export function startGroupPresenceHeartbeat(
  report: () => Promise<void>,
  scheduler: HeartbeatScheduler = window,
): () => void {
  const send = () => {
    void report().catch(() => {})
  }

  send()
  const handle = scheduler.setInterval(send, GROUP_PRESENCE_HEARTBEAT_MS)
  return () => scheduler.clearInterval(handle)
}
