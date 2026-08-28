import { Download, FileUp, Plus, Trash2, Users } from 'lucide-react'
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
import { MenuSelect } from '@/components/ui/menu-select'
import { downloadSampleCsvTemplate, parseStudentFile } from '@/lib/excel-helper'
import type { AcademicLevel, EngagementLevel, Gender, Student } from '@/types/group-formation'

interface StudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classNameTitle: string
  students: Student[]
  onAddStudent: (student: Omit<Student, 'id'>) => void
  onDeleteStudent: (studentId: string) => void
  onBulkAddStudents: (students: Student[]) => void
}

export function StudentDialog({
  open,
  onOpenChange,
  classNameTitle,
  students,
  onAddStudent,
  onDeleteStudent,
  onBulkAddStudents,
}: StudentDialogProps) {
  const [stuNum, setStuNum] = useState('')
  const [name, setName] = useState('')
  const [gender, setGender] = useState<Gender | ''>('')
  const [academicLevel, setAcademicLevel] = useState<AcademicLevel | ''>('')
  const [engagement, setEngagement] = useState<EngagementLevel | ''>('moderate')
  const [isUploading, setIsUploading] = useState(false)

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    onAddStudent({
      stuNum: stuNum ? Number(stuNum) : undefined,
      name: name.trim(),
      gender: gender || null,
      academicLevel: academicLevel || null,
      engagement: engagement || 'moderate',
    })

    setName('')
    setStuNum('')
    setGender('')
    setAcademicLevel('')
    setEngagement('moderate')
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      const parsed = await parseStudentFile(file)
      if (parsed.length > 0) {
        onBulkAddStudents(parsed)
      }
    } catch {
      // ignore
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="size-5 text-primary" />
            <span>학급 학생 관리 ({classNameTitle || '학급 미선택'})</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            학생 명단은 학급별로 자동 저장됩니다. Excel/CSV 파일로 한 번에 등록할 수도 있습니다.
          </DialogDescription>
        </DialogHeader>

        {/* File Upload & Sample Download Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 font-medium shadow-2xs hover:bg-accent">
              <FileUp className="size-3.5 text-primary" />
              <span>{isUploading ? '업로드 중…' : 'Excel / CSV 파일 등록'}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
            </label>
            <span className="text-[11px] text-muted-foreground">
              학번(선택), 학생명(필수), 성별/성적/발화(선택)
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-primary hover:text-primary"
            onClick={downloadSampleCsvTemplate}
          >
            <Download className="size-3.5" />
            양식 다운로드 (.xlsx)
          </Button>
        </div>

        {/* Quick Add Form */}
        <form onSubmit={handleAdd} className="grid grid-cols-12 gap-2 text-xs">
          <Input
            type="number"
            placeholder="번호"
            value={stuNum}
            onChange={(e) => setStuNum(e.target.value)}
            className="col-span-2 h-8 text-xs"
          />
          <Input
            placeholder="학생명 (필수)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="col-span-3 h-8 text-xs"
            required
          />
          <MenuSelect
            value={gender}
            onChange={(value) => setGender(value as Gender | '')}
            placeholder="성별: 미선택"
            className="col-span-2"
            options={[
              { value: '', label: '성별: 미선택' },
              { value: 'M', label: '남 (M)' },
              { value: 'F', label: '여 (F)' },
            ]}
          />
          <MenuSelect
            value={academicLevel}
            onChange={(value) => setAcademicLevel(value as AcademicLevel | '')}
            placeholder="성적: 미선택"
            className="col-span-2"
            options={[
              { value: '', label: '성적: 미선택' },
              { value: 'high', label: '상' },
              { value: 'mid', label: '중' },
              { value: 'low', label: '하' },
            ]}
          />
          <Button type="submit" size="sm" className="col-span-3 h-8 text-xs">
            <Plus className="size-3.5" />
            추가
          </Button>
        </form>

        {/* Students Table */}
        <div className="max-h-64 overflow-y-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b bg-muted/60 font-semibold text-muted-foreground">
              <tr>
                <th className="w-12 py-2 px-3 text-center">번호</th>
                <th className="py-2 px-3">학생명</th>
                <th className="py-2 px-3">성별</th>
                <th className="py-2 px-3">학업수준</th>
                <th className="py-2 px-3">참여·발화</th>
                <th className="w-12 py-2 px-3 text-center">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    등록된 학생이 없습니다. 위에서 학생을 추가하거나 엑셀 파일을 올려주세요.
                  </td>
                </tr>
              ) : (
                students.map((student, idx) => (
                  <tr key={student.id} className="transition-colors hover:bg-muted/30">
                    <td className="py-2 px-3 text-center font-mono font-bold text-muted-foreground">
                      {student.stuNum ?? idx + 1}
                    </td>
                    <td className="py-2 px-3 font-semibold">{student.name}</td>
                    <td className="py-2 px-3">
                      {student.gender === 'M' ? (
                        <Badge variant="outline" className="text-[10px] text-blue-600">
                          남성
                        </Badge>
                      ) : student.gender === 'F' ? (
                        <Badge variant="outline" className="text-[10px] text-pink-600">
                          여성
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {student.academicLevel === 'high' ? (
                        <Badge variant="secondary" className="text-[10px]">
                          상
                        </Badge>
                      ) : student.academicLevel === 'mid' ? (
                        <Badge variant="secondary" className="text-[10px]">
                          중
                        </Badge>
                      ) : student.academicLevel === 'low' ? (
                        <Badge variant="secondary" className="text-[10px]">
                          하
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {student.engagement === 'active' ? (
                        <span className="text-emerald-600 font-medium">적극</span>
                      ) : student.engagement === 'passive' ? (
                        <span className="text-amber-600 font-medium">소극</span>
                      ) : (
                        <span className="text-muted-foreground">보통</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => onDeleteStudent(student.id)}
                        aria-label={`${student.name} 학생 삭제`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
