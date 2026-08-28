import { ArrowRight, Check, Copy, Send } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FormedGroup } from '@/types/group-formation'

interface SyncDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classId: string
  classNameTitle: string
  groups: FormedGroup[]
  onProceedToDashboard?: () => void
}

export function SyncDialog({
  open,
  onOpenChange,
  classId,
  classNameTitle,
  groups,
  onProceedToDashboard,
}: SyncDialogProps) {
  const [copied, setCopied] = useState(false)

  const payload = {
    classId,
    className: classNameTitle,
    activeGroupSet: {
      title: `${classNameTitle} 편성 조`,
      groups,
    },
    totalStudents: groups.reduce((acc, g) => acc + g.members.length, 0),
    timestamp: new Date().toISOString(),
  }

  const jsonString = JSON.stringify(payload, null, 2)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="size-5 text-primary" />
            <span>교사 대시보드 데이터 연동</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            활동 세션 및 모둠 토의 모니터링 대시보드로 전달되는 정규 JSON 데이터입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <pre className="max-h-60 overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-indigo-300">
            {jsonString}
          </pre>

          <div className="flex items-center justify-between pt-1">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleCopy}>
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              <span>{copied ? '복사됨' : 'JSON 복사'}</span>
            </Button>

            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                onOpenChange(false)
                if (onProceedToDashboard) onProceedToDashboard()
              }}
            >
              <span>대시보드로 계속 진행</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
