import { ArrowRight, CircleAlert, Plus, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { MobileShell } from '@/components/common/mobile-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { data } from '@/data'
import {
  readLastStudentSession,
  readStudentSession,
  writeStudentSession,
} from '@/lib/student-session'
import { cn } from '@/lib/utils'
import type { Group, Session } from '@/types/domain'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ended'; session: Session }
  | { kind: 'ready'; session: Session; presetGroups: Group[] }

export default function JoinPage() {
  const { joinCode } = useParams<{ joinCode: string }>()
  const navigate = useNavigate()

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [groupName, setGroupName] = useState('')
  const [memberNames, setMemberNames] = useState<string[]>([''])
  const [existingGroupId, setExistingGroupId] = useState<string | undefined>()
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!joinCode) {
      setState({ kind: 'invalid' })
      return
    }

    let cancelled = false
    async function load() {
      try {
        const session = await data().findSessionByJoinCode(joinCode!)
        if (cancelled) return
        if (!session) {
          setState({ kind: 'invalid' })
          return
        }
        if (session.status === 'ended') {
          setState({ kind: 'ended', session })
          return
        }

        const snapshot = await data().getSessionSnapshot(session.id)
        if (cancelled) return
        const groups = snapshot?.groups ?? []

        // 같은 브라우저로 다시 들어오면 이전 입력을 채워 다시 타이핑하지 않게 한다.
        const previous = readStudentSession(session.id) ?? readLastStudentSession()
        if (previous) {
          setGroupName(previous.groupName)
          setMemberNames(previous.memberNames.length > 0 ? previous.memberNames : [''])
          const sameSession = readStudentSession(session.id)
          if (sameSession) setExistingGroupId(sameSession.groupId)
        }

        setState({ kind: 'ready', session, presetGroups: groups })
      } catch {
        if (!cancelled) setState({ kind: 'invalid' })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [joinCode])

  function selectPresetGroup(group: Group) {
    setGroupName(group.name)
    setMemberNames(
      group.members.length > 0 ? group.members.map((member) => member.name) : [''],
    )
    setExistingGroupId(group.joinedAt === null ? undefined : group.id)
  }

  async function join() {
    if (state.kind !== 'ready') return

    const trimmedGroup = groupName.trim()
    const trimmedMembers = memberNames.map((name) => name.trim()).filter(Boolean)

    if (!trimmedGroup) {
      toast.error('모둠을 선택하거나 이름을 입력해 주세요.')
      return
    }
    if (trimmedMembers.length === 0) {
      toast.error('모둠원 이름을 1명 이상 입력해 주세요.')
      return
    }

    setJoining(true)
    try {
      const group = await data().joinGroup({
        sessionId: state.session.id,
        groupName: trimmedGroup,
        memberNames: trimmedMembers,
        existingGroupId,
      })
      writeStudentSession({
        sessionId: state.session.id,
        groupId: group.id,
        groupName: group.name,
        memberNames: trimmedMembers,
      })
      navigate(`/student/${state.session.id}`, { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '입장하지 못했습니다.')
      setJoining(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <MobileShell className="gap-4 pt-16">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </MobileShell>
    )
  }

  if (state.kind === 'invalid') {
    return (
      <BlockedScreen
        title="입장할 수 없는 코드입니다"
        description="입장 코드가 잘못되었거나 활동이 삭제되었습니다. 선생님께 코드를 다시 확인해 주세요."
      />
    )
  }

  if (state.kind === 'ended') {
    return (
      <BlockedScreen
        title="이미 종료된 활동입니다"
        description={`${state.session.title} 활동은 종료되어 더 이상 입장할 수 없습니다.`}
      />
    )
  }

  const { session, presetGroups } = state
  const useRoster = session.useRoster && presetGroups.length > 0

  return (
    <MobileShell className="gap-7 pt-10">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm">모둠 활동에 입장합니다</p>
        <h1 className="text-2xl font-semibold tracking-tight">{session.title}</h1>
      </header>

      <div className="flex-1 space-y-7">
        <section className="space-y-3">
          <Label className="text-base">모둠 선택</Label>

          {useRoster ? (
            <div className="grid grid-cols-2 gap-2.5">
              {presetGroups.map((group) => {
                const selected = group.name === groupName
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => selectPresetGroup(group)}
                    className={cn(
                      'flex min-h-16 flex-col items-start justify-center gap-1 rounded-xl border px-4 py-3 text-left transition-colors',
                      selected ? 'border-primary bg-accent' : 'bg-card active:bg-muted',
                    )}
                  >
                    <span className="font-medium">{group.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {group.joinedAt ? '입장한 모둠' : `${group.members.length}명`}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <Input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="예: 3모둠"
              className="h-12 text-base"
            />
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base">모둠원 이름</Label>
            <span className="text-muted-foreground text-xs">전체를 입력해 주세요</span>
          </div>

          <div className="space-y-2">
            {memberNames.map((name, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={name}
                  onChange={(event) =>
                    setMemberNames((prev) =>
                      prev.map((item, i) => (i === index ? event.target.value : item)),
                    )
                  }
                  placeholder={`${index + 1}번째 모둠원`}
                  className="h-12 text-base"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-12 shrink-0"
                  disabled={memberNames.length <= 1}
                  onClick={() => setMemberNames((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`${index + 1}번째 모둠원 삭제`}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => setMemberNames((prev) => [...prev, ''])}
          >
            <Plus className="size-4" />
            모둠원 추가
          </Button>
        </section>

        <p className="text-muted-foreground rounded-lg border px-4 py-3 text-xs leading-relaxed">
          활동 중 모둠 대화는 참여 상태를 확인하는 목적으로만 사용되고 선생님이 봅니다. 대화는 학생
          개인을 평가하는 데 쓰이지 않습니다.
        </p>
      </div>

      <Button size="xl" className="w-full" onClick={join} disabled={joining}>
        {joining ? '입장하는 중…' : '입장하기'}
        <ArrowRight className="size-4" />
      </Button>
    </MobileShell>
  )
}

function BlockedScreen({ title, description }: { title: string; description: string }) {
  return (
    <MobileShell className="items-center justify-center gap-5 text-center">
      <div className="bg-danger-soft text-danger flex size-14 items-center justify-center rounded-2xl">
        <CircleAlert className="size-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </div>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Users className="size-3.5" />
        모둠 기기 한 대로 함께 입장하세요
      </p>
    </MobileShell>
  )
}
