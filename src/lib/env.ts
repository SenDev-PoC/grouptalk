const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  livekitUrl: import.meta.env.VITE_LIVEKIT_URL?.trim() ?? '',
  /**
   * LiveKit 접속 토큰을 발급하는 백엔드 엔드포인트.
   * 비워두면 Supabase Edge Function `livekit-token`을 호출한다.
   */
  livekitTokenEndpoint: import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT?.trim() ?? '',
}

/** Supabase 키가 없으면 앱 전체가 데모 데이터로 동작한다. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
