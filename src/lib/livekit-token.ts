import { data } from '@/data'
import { getSupabase } from '@/data/supabase'
import { env, isSupabaseConfigured } from '@/lib/env'

export interface LiveKitGrant {
  url: string
  token: string
  roomName: string
}

export interface LiveKitTokenRequest {
  sessionId: string
  groupId: string
  groupName: string
  clientDeviceKey: string
}

/**
 * LiveKit 접속 토큰은 서버에서만 서명할 수 있으므로 백엔드 계약을 호출한다.
 * - VITE_LIVEKIT_TOKEN_ENDPOINT 가 있으면 그 주소로 POST
 * - 없으면 Supabase Edge Function `livekit-token` 호출
 * 응답: { url, token, roomName }
 */
export async function requestLiveKitGrant(
  request: LiveKitTokenRequest,
): Promise<LiveKitGrant | null> {
  if (data().mode === 'demo') return null

  try {
    if (env.livekitTokenEndpoint) {
      const sessionResult = await getSupabase().auth.getSession()
      const accessToken = sessionResult.data.session?.access_token
      if (sessionResult.error || !accessToken) return null
      const response = await fetch(env.livekitTokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(request),
      })
      if (!response.ok) return null
      return normalize(await response.json())
    }

    if (!isSupabaseConfigured) return null

    const { data: result, error } = await getSupabase().functions.invoke('livekit-token', {
      body: request,
    })
    if (error) return null
    return normalize(result)
  } catch {
    return null
  }
}

function normalize(payload: unknown): LiveKitGrant | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const token = typeof record.token === 'string' ? record.token : ''
  const url = typeof record.url === 'string' && record.url ? record.url : env.livekitUrl
  const roomName = typeof record.roomName === 'string' ? record.roomName : ''
  if (!token || !url) return null
  return { url, token, roomName }
}
