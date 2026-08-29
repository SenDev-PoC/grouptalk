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
  if (user.is_anonymous) {
    throw new Error('교사 계정만 사용할 수 있습니다.')
  }
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

function demoPasswordHash(email: string, password: string) {
  return sha256(`${email}:${password}`)
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

export const MIN_PASSWORD_LENGTH = 8

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
    return '이 이메일로는 새로 가입할 수 없습니다. 로그인을 시도해 주세요.'
  }
  if (lower.includes('password') && lower.includes('at least')) {
    return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`
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
  if (message.startsWith('비밀번호') || message.startsWith('이름을') || message.startsWith('이메일을')) {
    return message
  }
  return '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

function assertPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`)
  }
}

function normalizeDisplayName(name: string) {
  const trimmed = name.trim().slice(0, 40)
  if (!trimmed) throw new Error('이름을 입력해 주세요.')
  return trimmed
}

async function supabaseSignIn(email: string, password: string): Promise<AuthUser> {
  assertPassword(password)
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
  assertPassword(input.password)
  const displayName = normalizeDisplayName(input.displayName)
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
      data: { display_name: displayName },
      emailRedirectTo: `${window.location.origin}/login`,
    },
  })
  if (error) throw new Error(mapAuthError(error))
  if (data.user?.identities && data.user.identities.length === 0) {
    return { kind: 'confirm-email', email }
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
  assertPassword(password)
  const normalized = normalizeEmail(email)
  const account = readDemoAccounts().find((item) => item.email === normalized)
  if (!account) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
  }
  const hash = await demoPasswordHash(normalized, password)
  if (hash !== account.passwordHash) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
  }
  localStorage.setItem(DEMO_SESSION_KEY, account.email)
  const user = demoToUser(account)
  notifyDemo(user)
  return user
}

async function demoSignUp(input: SignUpInput): Promise<SignUpResult> {
  assertPassword(input.password)
  const displayName = normalizeDisplayName(input.displayName)
  const email = normalizeEmail(input.email)
  const accounts = readDemoAccounts()
  if (accounts.some((item) => item.email === email)) {
    throw new Error('이 이메일로는 새로 가입할 수 없습니다. 로그인을 시도해 주세요.')
  }
  const teacherId =
    accounts.length === 0
      ? (peekLocalTeacherId() ?? `teacher_${crypto.randomUUID()}`)
      : `teacher_${crypto.randomUUID()}`
  const account: DemoAccount = {
    email,
    passwordHash: await demoPasswordHash(email, input.password),
    teacherId,
    displayName,
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

export class TeacherSessionOnStudentDeviceError extends StudentAuthError {
  constructor() {
    super('교사 계정이 로그인된 브라우저에서는 학생으로 입장할 수 없습니다.')
    this.name = 'TeacherSessionOnStudentDeviceError'
  }
}

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
    throw new TeacherSessionOnStudentDeviceError()
  }

  const result = await db.auth.signInAnonymously()
  if (result.error) throw new StudentAuthError(result.error.message)
  if (!result.data.session || !result.data.user?.is_anonymous) {
    throw new StudentAuthError('학생 인증 세션을 만들지 못했습니다.')
  }
  return result.data.session
}
