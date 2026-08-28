import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { data } from '@/data'
import type { Activity } from '@/types/domain'

interface CreateActivityDialogProps {
  teacherId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (activity: Activity) => void
}

export function CreateActivityDialog({
  teacherId,
  open,
  onOpenChange,
  onCreated,
}: CreateActivityDialogProps) {
  const [title, setTitle] = useState('')
  const [steps, setSteps] = useState<string[]>([''])
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle('')
    setSteps([''])
    setSaving(false)
  }

  function updateStep(index: number, value: string) {
    setSteps((prev) => prev.map((step, i) => (i === index ? value : step)))
  }

  function removeStep(index: number) {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  async function submit() {
    const trimmedTitle = title.trim()
    const trimmedSteps = steps.map((step) => step.trim()).filter(Boolean)

    if (!trimmedTitle) return
    if (trimmedSteps.length === 0) return

    setSaving(true)
    try {
      const activity = await data().createActivity({
        teacherId,
        title: trimmedTitle,
        steps: trimmedSteps,
      })
      onCreated(activity)
      onOpenChange(false)
      reset()
    } catch {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>활동 만들기</DialogTitle>
          <DialogDescription>
            활동은 저장만 됩니다. 수업에서 쓸 때 목록에서 「시작하기」를 눌러 세션을 엽니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-2">
            <Label htmlFor="activity-title">활동명</Label>
            <Input
              id="activity-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 기후 변화 대응, 우리 학교부터"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>활동 단계</Label>
              <span className="text-muted-foreground text-xs">학생 화면에서 선택합니다</span>
            </div>

            <div className="space-y-2">
              {steps.map((step, index) => (
                <div key={index} className="flex items-center gap-2">
                  <GripVertical className="text-muted-foreground/60 size-4 shrink-0" />
                  <Input
                    value={step}
                    onChange={(event) => updateStep(index, event.target.value)}
                    placeholder={`${index + 1}단계 이름`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={steps.length <= 1}
                    onClick={() => removeStep(index)}
                    aria-label={`${index + 1}단계 삭제`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setSteps((prev) => [...prev, ''])}
            >
              <Plus className="size-4" />
              단계 추가
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
