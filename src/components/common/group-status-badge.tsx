import { AlertTriangle, CircleHelp, Radio, SignalHigh, TimerReset, Users } from 'lucide-react'
import type { ComponentType } from 'react'

import { Badge } from '@/components/ui/badge'
import type { GroupDisplayState, GroupStatus } from '@/lib/group-status'
import { TONE_CLASS } from '@/lib/group-status'
import { cn } from '@/lib/utils'

const ICONS: Record<GroupDisplayState, ComponentType<{ className?: string }>> = {
  balanced: SignalHigh,
  skewed: AlertTriangle,
  insufficient: CircleHelp,
  stale: TimerReset,
  unknown: CircleHelp,
  lost: Radio,
  not_ready: Users,
}

export function GroupStatusBadge({
  status,
  className,
}: {
  status: GroupStatus
  className?: string
}) {
  const Icon = ICONS[status.state]
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[status.tone], className)}>
      <Icon className="size-3" />
      {status.label}
    </Badge>
  )
}
