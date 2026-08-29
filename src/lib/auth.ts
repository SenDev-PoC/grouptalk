import type { User } from '@supabase/supabase-js'

import { isSupabaseConfigured } from '@/lib/env'
import { peekLocalTeacherId } from '@/lib/teacher'

export type AuthUser = {
  id: string
  email: string
  displayName: string
}

export type SignUpInput = {
  email: string
  password: string
  displayName: string
}

export type SignUpResult =
  | { kind: 'session'; user: AuthUser }
  | { kind: 'confirm-email'; email: string }

const DEMO_ACCOUNTS_KEY = 'moodumview.demoAccounts'
const DEMO_SESSION_KEY = 'moodumview.demoSession'

type DemoAccount = {
  email: string
  passwordHash: string
  teacherId: string
  displayName: string
}

const demoListeners = new Set<(user: AuthUser | null) => void>()

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function toAuthUser(user: User): AuthUser {
  const meta = user.user_metadata ?? {}
  const fromMeta =
    typeof meta.display_name === 'string' ? meta.display_name.trim() : ''
  return {
    id: user.id,
    email: user.email ?? '',
    displayName: fromMeta || (user.email ?? '').split('@')[0] || '교사',
  }
}

function demoToUser(account: DemoAccount): AuthUser {
  return {
    id: account.teacherId,
    email: account.email,
    displayName: account.displayName,
  }
}

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function readDemoAccounts(): DemoAccount[] {
  try {
    const raw = localStorage.getItem(DEMO_ACCOUNTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as DemoAccount[]) : []
  } catch {
    return []
  }
}

function writeDemoAccounts(accounts: DemoAccount[]) {
  localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify(accounts))
}

function readDemoSessionUser(): AuthUser | null {
  const email = localStorage.getItem(DEMO_SESSION_KEY)
  if (!email) return null
  const account = readDemoAccounts().find((item) => item.email === email)
  return account ? demoToUser(account) : null
}

function notifyDemo(user: AuthUser | null) {
  demoListeners.forEach((listener) => listener(user))
}

export function mapAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes('invalid login credentials')) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.'
  }
  if (lower.includes('email not confirmed')) {
    return '이메일 인증이 필요합니다. 받은 편지함의 링크를 확인해 주세요.'
  }
  if (
    lower.includes('user already registered') ||
    lower.includes('already been registered') ||
    lower.includes('already registered')
  ) {
    return '이미 가입된 이메일입니다. 로그인해 주세요.'
  }
  if (lower.includes('password') && lower.includes('at least')) {
    return '비밀번호는 6자 이상이어야 합니다.'
  }
  if (lower.includes('invalid email') || lower.includes('unable to validate email')) {
    return '올바른 이메일 주소를 입력해 주세요.'
  }
  if (lower.includes('signup is disabled')) {
    return '현재 회원가입이 중단되어 있습니다.'
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
  }
  if (message.trim()) return message
  return '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

async function supabaseSignIn(email: string, password: string): Promise<AuthUser> {
  const { getSupabase } = await import('@/data/supabase')
  const db = getSupabase()
  const current = await db.auth.getSession()
  if (current.error) throw new Error(mapAuthError(current.error))
  if (current.data.session?.user.is_anonymous) {
    const signOutResult = await db.auth.signOut()
    if (signOutResult.error) throw new Error(mapAuthError(signOutResult.error))
  }

  const { data, error } = await db.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  })
  if (error) throw new Error(mapAuthError(error))
  if (!data.user || data.user.is_anonymous) {
    throw new Error('로그인에 실패했습니다. 다시 시도해 주세요.')
  }
  return toAuthUser(data.user)
}

async function supabaseSignUp(input: SignUpInput): Promise<SignUpResult> {
  const { getSupabase } = await import('@/data/supabase')
  const db = getSupabase()
  const current = await db.auth.getSession()
  if (current.error) throw new Error(mapAuthError(current.error))
  if (current.data.session?.user.is_anonymous) {
    const signOutResult = await db.auth.signOut()
    if (signOutResult.error) throw new Error(mapAuthError(signOutResult.error))
  }

  const email = normalizeEmail(input.email)
  const { data, error } = await db.auth.signUp({
    email,
    password: input.password,
    options: {
      data: { display_name: input.displayName.trim() },
      emailRedirectTo: `${window.location.origin}/login`,
    },
  })
  if (error) throw new Error(mapAuthError(error))
  if (data.user?.identities && data.user.identities.length === 0) {
    throw new Error('이미 가입된 이메일입니다. 로그인해 주세요.')
  }
  if (data.session?.user) {
    return { kind: 'session', user: toAuthUser(data.session.user) }
  }
  return { kind: 'confirm-email', email }
}

async function supabaseSignOut() {
  const { getSupabase } = await import('@/data/supabase')
  const { error } = await getSupabase().auth.signOut()
  if (error) throw new Error(mapAuthError(error))
}

function subscribeSupabase(onChange: (user: AuthUser | null) => void) {
  let cancelled = false
  let unsubscribe = () => {}
  void import('@/data/supabase')
    .then(({ getSupabase }) => {
      if (cancelled) return
      const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
        const teacher =
          session?.user && !session.user.is_anonymous ? toAuthUser(session.user) : null
        onChange(teacher)
      })
      unsubscribe = () => data.subscription.unsubscribe()
      if (cancelled) unsubscribe()
    })
    .catch(() => {
      if (!cancelled) onChange(null)
    })
  return () => {
    cancelled = true
    unsubscribe()
  }
}

async function demoSignIn(email: string, password: string): Promise<AuthUser> {
  const normalized = normalizeEmail(email)
  const account = readDemoAccounts().find((item) => item.email === normalized)
  if (!account) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
  }
  const hash = await sha256(password)
  if (hash !== account.passwordHash) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
  }
  localStorage.setItem(DEMO_SESSION_KEY, account.email)
  const user = demoToUser(account)
  notifyDemo(user)
  return user
}

async function demoSignUp(input: SignUpInput): Promise<SignUpResult> {
  const email = normalizeEmail(input.email)
  const accounts = readDemoAccounts()
  if (accounts.some((item) => item.email === email)) {
    throw new Error('이미 가입된 이메일입니다. 로그인해 주세요.')
  }
  const teacherId =
    accounts.length === 0
      ? (peekLocalTeacherId() ?? `teacher_${crypto.randomUUID()}`)
      : `teacher_${crypto.randomUUID()}`
  const account: DemoAccount = {
    email,
    passwordHash: await sha256(input.password),
    teacherId,
    displayName: input.displayName.trim(),
  }
  writeDemoAccounts([...accounts, account])
  localStorage.setItem(DEMO_SESSION_KEY, account.email)
  const user = demoToUser(account)
  notifyDemo(user)
  return { kind: 'session', user }
}

async function demoSignOut() {
  localStorage.removeItem(DEMO_SESSION_KEY)
  notifyDemo(null)
}

function subscribeDemo(onChange: (user: AuthUser | null) => void) {
  demoListeners.add(onChange)
  onChange(readDemoSessionUser())
  return () => {
    demoListeners.delete(onChange)
  }
}

export function subscribeAuth(onChange: (user: AuthUser | null) => void) {
  return isSupabaseConfigured ? subscribeSupabase(onChange) : subscribeDemo(onChange)
}

export function signIn(email: string, password: string) {
  return isSupabaseConfigured ? supabaseSignIn(email, password) : demoSignIn(email, password)
}

export function signUp(input: SignUpInput) {
  return isSupabaseConfigured ? supabaseSignUp(input) : demoSignUp(input)
}

export function signOut() {
  return isSupabaseConfigured ? supabaseSignOut() : demoSignOut()
}

export class StudentAuthError extends Error {}

/**
 * 학생 기기는 입장 전에 anonymous Auth 세션을 하나 만들고 계속 재사용한다.
 * 교사 계정이 로그인된 브라우저를 학생 세션으로 암묵적으로 바꾸지는 않는다.
 */
export async function ensureAnonymousStudentSession() {
  const { getSupabase } = await import('@/data/supabase')
  const db = getSupabase()
  const { data, error } = await db.auth.getSession()
  if (error) throw new StudentAuthError(error.message)

  if (data.session) {
    if (data.session.user.is_anonymous) return data.session
    throw new StudentAuthError('교사 계정이 로그인된 브라우저에서는 학생으로 입장할 수 없습니다.')
  }

  const result = await db.auth.signInAnonymously()
  if (result.error) throw new StudentAuthError(result.error.message)
  if (!result.data.session || !result.data.user?.is_anonymous) {
    throw new StudentAuthError('학생 인증 세션을 만들지 못했습니다.')
  }
  return result.data.session
}
