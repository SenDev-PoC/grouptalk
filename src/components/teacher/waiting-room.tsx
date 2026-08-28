import { CheckCircle2, Circle, Play, Users } from 'lucide-react'
import { useState } from 'react'

import { JoinCodeDialog } from '@/components/common/join-code-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { data } from '@/data'
import type { SessionSnapshot } from '@/data/types'
import { cn } from '@/lib/utils'

export function WaitingRoom({ snapshot }: { snapshot: SessionSnapshot }) {
  const { session, groups } = snapshot
  const [starting, setStarting] = useState(false)

  const joinedGroups = groups.filter((group) => group.joinedAt !== null)
  const pendingGroups = groups.filter((group) => group.joinedAt === null)
  const canStart = joinedGroups.length >= 1

  async function startActivity() {
    setStarting(true)
    try {
      await data().setSessionStatus(session.id, 'active')
    } catch {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">{session.title}</h1>
            <Badge variant="outline" className="border-warning/40 text-warning">
              대기 중
            </Badge>
            <JoinCodeDialog joinCode={session.joinCode} />
          </div>
        </div>

        <Button size="lg" disabled={!canStart || starting} onClick={startActivity}>
          <Play className="size-4" />
          {starting ? '시작하는 중…' : '활동 시작'}
        </Button>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="text-muted-foreground size-4" />
              입장한 모둠
              <span className="tabular text-primary">{joinedGroups.length}</span>
              {groups.length > 0 && (
                <span className="text-muted-foreground font-normal">/ {groups.length}</span>
              )}
            </CardTitle>
          </CardHeader>

          <CardContent>
            {groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-14 text-center">
                <p className="text-sm font-medium">아직 들어온 모둠이 없습니다</p>
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {[...joinedGroups, ...pendingGroups].map((group) => {
                  const joined = group.joinedAt !== null
                  return (
                    <li
                      key={group.id}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg border px-4 py-3',
                        joined ? 'border-success/35 bg-success-soft' : 'bg-muted/30',
                      )}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-sm font-medium">{group.name}</p>
                        {group.members.length > 0 && (
                          <p className="text-muted-foreground truncate text-xs">
                            {group.members.map((member) => member.name).join(' · ')}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          'flex shrink-0 items-center gap-1.5 text-xs',
                          joined ? 'text-success' : 'text-muted-foreground',
                        )}
                      >
                        {joined ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : (
                          <Circle className="size-3.5" />
                        )}
                        {joined ? '입장 완료' : '대기 중'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

            {!canStart && groups.length > 0 && (
              <p className="text-muted-foreground mt-4 text-xs">
                모둠이 최소 1개 입장해야 활동을 시작할 수 있습니다.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
