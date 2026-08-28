import { formatDateTime, formatTime } from '@/lib/format'
import type { Group, Session, Utterance } from '@/types/domain'

/** 사후 리포트에서 내려받는 전사 텍스트. 익명 화자 표시의 한계를 파일 안에도 남긴다. */
export function buildTranscriptText(
  session: Session,
  groups: Group[],
  utterances: Utterance[],
): string {
  const lines: string[] = [
    `활동명: ${session.title}`,
    `입장 코드: ${session.joinCode}`,
    `시작: ${formatDateTime(session.startedAt)}`,
    `종료: ${formatDateTime(session.endedAt)}`,
    '',
    '화자 A·B·C는 대화 안에서 목소리를 구분한 임시 표시이며 특정 학생을 가리키지 않습니다.',
    '이 기록은 수업 지원 목적이며 학생 평가 근거로 사용하지 않습니다.',
    '',
  ]

  for (const group of groups) {
    const groupUtterances = utterances.filter((utterance) => utterance.groupId === group.id)
    lines.push('─'.repeat(48), `[${group.name}]`)
    if (group.members.length > 0) {
      lines.push(`모둠원: ${group.members.map((member) => member.name).join(', ')}`)
    }
    lines.push('')

    if (groupUtterances.length === 0) {
      lines.push('(수집된 대화가 없습니다.)', '')
      continue
    }

    for (const utterance of groupUtterances) {
      lines.push(`${formatTime(utterance.spokenAt)}  ${utterance.speakerLabel}: ${utterance.text}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
