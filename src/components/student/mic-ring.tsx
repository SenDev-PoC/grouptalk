import { Loader2, Mic, MicOff, TriangleAlert } from 'lucide-react'

import type { MicPhase } from '@/hooks/use-mic-session'
import { cn } from '@/lib/utils'

const COPY: Record<MicPhase, { title: string; hint: string }> = {
  idle: { title: '마이크 연결 전', hint: '아래 버튼을 눌러 대화 기록을 시작하세요.' },
  connecting: { title: '연결 중', hint: '마이크를 준비하고 있어요.' },
  listening: { title: '듣고 있어요', hint: '편하게 이야기하세요.' },
  speaking: { title: '말하는 중', hint: '목소리가 잘 들어오고 있어요.' },
  muted: { title: '마이크 꺼짐', hint: '다시 켜면 대화가 이어집니다.' },
  error: { title: '연결 실패', hint: '아래 버튼으로 다시 연결해 주세요.' },
}

export function MicRing({
  phase,
  level,
  onToggle,
}: {
  phase: MicPhase
  level: number
  onToggle: () => void
}) {
  const copy = COPY[phase]
  const active = phase === 'listening' || phase === 'speaking'
  const scale = 1 + Math.min(level, 1) * 0.14

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative flex size-36 items-center justify-center">
        {active && (
          <>
            <span className="border-primary/40 absolute size-28 rounded-full border-2 animate-mic-ring" />
            <span
              className="border-primary/30 absolute size-28 rounded-full border-2 animate-mic-ring"
              style={{ animationDelay: '0.8s' }}
            />
          </>
        )}

        <button
          type="button"
          onClick={onToggle}
          disabled={phase === 'connecting' || phase === 'idle'}
          className={cn(
            'relative flex size-28 items-center justify-center rounded-full transition-colors duration-200',
            'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2',
            phase === 'speaking' && 'bg-primary text-primary-foreground',
            phase === 'listening' && 'bg-primary/90 text-primary-foreground',
            phase === 'muted' && 'bg-muted text-muted-foreground',
            phase === 'connecting' && 'bg-muted text-muted-foreground',
            phase === 'idle' && 'bg-muted text-muted-foreground',
            phase === 'error' && 'bg-danger-soft text-danger',
          )}
          style={active ? { transform: `scale(${scale})` } : undefined}
          aria-label={phase === 'muted' ? '마이크 켜기' : '마이크 끄기'}
        >
          {phase === 'connecting' ? (
            <Loader2 className="size-9 animate-spin" />
          ) : phase === 'error' ? (
            <TriangleAlert className="size-9" />
          ) : phase === 'muted' || phase === 'idle' ? (
            <MicOff className="size-9" />
          ) : (
            <Mic className="size-9" />
          )}
        </button>
      </div>

      <div className="space-y-0.5 text-center">
        <p className="text-base font-bold">{copy.title}</p>
        <p className="text-muted-foreground text-xs">{copy.hint}</p>
      </div>
    </div>
  )
}
