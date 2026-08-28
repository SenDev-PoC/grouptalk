import { History, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ArchivedGroupSet } from '@/types/group-formation'

interface HistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  archivedSets: ArchivedGroupSet[]
  onRestoreSet: (set: ArchivedGroupSet) => void
}

export function HistoryDialog({
  open,
  onOpenChange,
  archivedSets,
  onRestoreSet,
}: HistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="size-5 text-primary" />
            <span>이전 조 편성 기록 (아카이브)</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            이전에 확정했던 조 구성 목록을 확인하고 다시 불러올 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1 text-xs">
          {archivedSets.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              보관된 이전 조 편성 기록이 없습니다.
            </p>
          ) : (
            archivedSets.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border bg-card p-3 shadow-2xs"
              >
                <div className="space-y-0.5">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.createdAt} ({item.groups.length}개 조,{' '}
                    {item.groups.reduce((acc, g) => acc + g.members.length, 0)}명)
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    onRestoreSet(item)
                    onOpenChange(false)
                  }}
                >
                  <RotateCcw className="size-3" />
                  불러오기
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
