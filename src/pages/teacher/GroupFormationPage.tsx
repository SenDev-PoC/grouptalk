import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { TeacherShell } from '@/components/common/teacher-shell'
import { GroupFormationView } from '@/components/teacher/group-formation/group-formation-view'
import { Button } from '@/components/ui/button'
import { useTeacherId } from '@/hooks/use-teacher-id'

export default function GroupFormationPage() {
  const teacherId = useTeacherId()
  const navigate = useNavigate()

  return (
    <TeacherShell
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-primary-foreground hover:bg-white/10"
          onClick={() => navigate('/teacher')}
        >
          <ArrowLeft className="size-3.5" />
          <span>교사 홈으로</span>
        </Button>
      }
      wide
    >
      <GroupFormationView
        teacherId={teacherId}
        onOpenDashboard={() => navigate('/teacher')}
      />
    </TeacherShell>
  )
}
