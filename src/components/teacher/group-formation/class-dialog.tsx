import { FolderCog, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ClassRoom } from '@/types/group-formation'

interface ClassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: ClassRoom[]
  selectedClassId: string
  onSelectClass: (classId: string) => void
  onAddClass: (name: string, subject?: string) => void
  onDeleteClass: (classId: string) => void
}

export function ClassDialog({
  open,
  onOpenChange,
  classes,
  selectedClassId,
  onSelectClass,
  onAddClass,
  onDeleteClass,
}: ClassDialogProps) {
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onAddClass(name.trim(), subject.trim() || undefined)
    setName('')
    setSubject('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderCog className="size-5 text-primary" />
            <span>학급 / 수업 목록 관리</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            학급별로 학생 명단과 모둠 편성 기록이 안전하게 분리되어 보관됩니다.
          </DialogDescription>
        </DialogHeader>

        {/* Add New Class Form */}
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-muted/40 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Plus className="size-4 text-primary" />
            <span>새 학급 / 수업 개설</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="class-name-input" className="text-[11px] text-muted-foreground">
                학년·반 (필수)
              </Label>
              <Input
                id="class-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 3학년 2반, 1-4반"
                className="h-8 text-xs"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="class-subject-input" className="text-[11px] text-muted-foreground">
                과목 / 활동명 (선택)
              </Label>
              <Input
                id="class-subject-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="예: 통합사회, 과학"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Button type="submit" size="sm" className="w-full text-xs">
            <Plus className="size-3.5" />
            새 학급 추가 및 저장
          </Button>
        </form>

        {/* Existing Classes List */}
        <div className="space-y-2">
          <p className="text-xs font-semibold">등록된 학급 목록 ({classes.length}개)</p>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {classes.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                등록된 학급이 없습니다. 위에서 새 학급을 개설해주세요.
              </p>
            ) : (
              classes.map((cls) => {
                const isSelected = cls.id === selectedClassId
                return (
                  <div
                    key={cls.id}
                    className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                      isSelected ? 'border-primary/40 bg-primary/5' : 'bg-card'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{cls.name}</span>
                        {cls.subject && (
                          <span className="text-[11px] text-muted-foreground">({cls.subject})</span>
                        )}
                        {isSelected && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            현재 선택
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        학생 {cls.students.length}명 · 확정 조:{' '}
                        {cls.activeGroups ? '있음' : '없음'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!isSelected && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => {
                            onSelectClass(cls.id)
                            onOpenChange(false)
                          }}
                        >
                          선택
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => onDeleteClass(cls.id)}
                        aria-label={`${cls.name} 학급 삭제`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
