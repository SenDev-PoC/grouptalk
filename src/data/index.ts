import { isSupabaseConfigured } from '@/lib/env'

import { createDemoData } from './demo'
import { createSupabaseData } from './supabase'
import type { DataClient } from './types'

let instance: DataClient | null = null

/** Supabase 키가 설정돼 있으면 실서비스, 없으면 데모 데이터로 같은 화면을 돌린다. */
export function data(): DataClient {
  if (!instance) {
    instance = isSupabaseConfigured ? createSupabaseData() : createDemoData()
  }
  return instance
}

export const isDemoMode = !isSupabaseConfigured

export type { DataClient } from './types'
