import { useAuth } from '@/hooks/use-auth'

export function useTeacherId() {
  const { user } = useAuth()
  return user?.id ?? ''
}
