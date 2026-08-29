import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-2xl">
          <Compass className="size-7" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">페이지를 찾을 수 없습니다</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            주소가 잘못되었거나 활동이 삭제되었을 수 있습니다. 입장 코드를 다시 확인해 주세요.
          </p>
        </div>
        <Button asChild>
          <Link to="/">처음으로</Link>
        </Button>
      </div>
    </main>
  )
}
