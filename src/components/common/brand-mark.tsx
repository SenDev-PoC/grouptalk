import { Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

export function BrandMark({
  to = '/',
  inverted = false,
}: {
  to?: string
  inverted?: boolean
}) {
  return (
    <Link to={to} className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-lg',
          inverted ? 'bg-white/15 text-primary-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        <Users className="size-4.5" />
      </span>
      <span
        className={cn(
          'text-sm font-bold tracking-tight',
          inverted && 'text-primary-foreground',
        )}
      >
        모둠뷰
      </span>
    </Link>
  )
}
