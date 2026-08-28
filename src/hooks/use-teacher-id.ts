import { useState } from 'react'

import { getTeacherId } from '@/lib/teacher'

export function useTeacherId() {
  const [teacherId] = useState(getTeacherId)
  return teacherId
}
