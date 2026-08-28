import type {
  FormedGroup,
  GroupingOptions,
  RelationshipRule,
  Student,
} from '@/types/group-formation'

function getAcademicScore(s: Student): number {
  if (s.academicLevel === 'high') return 3
  if (s.academicLevel === 'low') return 1
  return 2
}

function getEngagementScore(s: Student): number {
  if (s.engagement === 'active') return 3
  if (s.engagement === 'passive') return 1
  return 2
}

export function executeGrouping(
  students: Student[],
  options: GroupingOptions,
  relationships: RelationshipRule[],
): FormedGroup[] {
  if (!students || students.length === 0) {
    return []
  }

  let k = options.targetGroupCount
  if (options.groupMode === 'bySize') {
    k = Math.max(1, Math.ceil(students.length / Math.max(1, options.targetGroupSize)))
  }
  k = Math.max(1, Math.min(k, students.length))

  const groups: FormedGroup[] = Array.from({ length: k }, (_, i) => ({
    groupId: i + 1,
    groupName: `${i + 1}조`,
    members: [],
  }))

  // 1. Must Together Union-Find
  const mustTog = relationships.filter((r) => r.type === 'mustTogether')
  const parent: Record<string, string> = {}
  students.forEach((s) => {
    parent[s.id] = s.id
  })

  const find = (i: string): string => {
    if (parent[i] === i) return i
    parent[i] = find(parent[i])
    return parent[i]
  }

  const union = (i: string, j: string) => {
    const rootI = find(i)
    const rootJ = find(j)
    if (rootI !== rootJ) parent[rootI] = rootJ
  }

  mustTog.forEach((r) => {
    if (parent[r.studentAId] && parent[r.studentBId]) {
      union(r.studentAId, r.studentBId)
    }
  })

  const clusterMap: Record<string, Student[]> = {}
  students.forEach((s) => {
    const root = find(s.id)
    if (!clusterMap[root]) clusterMap[root] = []
    clusterMap[root].push(s)
  })

  const clusters = Object.values(clusterMap)

  const isAcademicHomo = options.academicOption === 'homo'
  const isEngagementHomo = options.engagementOption === 'homo'

  if (isAcademicHomo || isEngagementHomo) {
    // Homogeneous Sort (Group similar together)
    clusters.sort((a, b) => {
      let scoreA = 0
      let scoreB = 0
      if (isEngagementHomo) {
        scoreA += (a.reduce((sum, s) => sum + getEngagementScore(s), 0) / a.length) * 10
        scoreB += (b.reduce((sum, s) => sum + getEngagementScore(s), 0) / b.length) * 10
      }
      if (isAcademicHomo) {
        scoreA += (a.reduce((sum, s) => sum + getAcademicScore(s), 0) / a.length) * 5
        scoreB += (b.reduce((sum, s) => sum + getAcademicScore(s), 0) / b.length) * 5
      }
      return scoreB - scoreA
    })

    let gIdx = 0
    const maxPerGroup = Math.ceil(students.length / k)
    clusters.forEach((c) => {
      if (groups[gIdx].members.length + c.length > maxPerGroup && gIdx < k - 1) {
        gIdx++
      }
      groups[gIdx].members.push(...c)
    })
  } else if (
    options.academicOption === 'hetero' ||
    options.engagementOption === 'hetero' ||
    options.genderOption === 'balance'
  ) {
    // Heterogeneous Sort & Greedy Penalty Assignment
    clusters.sort((a, b) => {
      const scoreA =
        a.reduce((sum, s) => sum + getAcademicScore(s) + getEngagementScore(s), 0) / a.length
      const scoreB =
        b.reduce((sum, s) => sum + getAcademicScore(s) + getEngagementScore(s), 0) / b.length
      return scoreB - scoreA
    })

    const mustSep = relationships.filter((r) => r.type === 'mustSeparate')
    const prefTog = relationships.filter((r) => r.type === 'preferTogether')

    clusters.forEach((cluster) => {
      let bestIdx = 0
      let minPenalty = Infinity
      const minCount = Math.min(...groups.map((g) => g.members.length))
      const candidates = groups
        .map((g, idx) => (g.members.length <= minCount + 1 ? idx : -1))
        .filter((idx) => idx !== -1)

      candidates.forEach((idx) => {
        const grp = groups[idx]
        let penalty = 0

        // Must Separate Check
        for (const s of cluster) {
          for (const ex of grp.members) {
            if (
              mustSep.some(
                (r) =>
                  (r.studentAId === s.id && r.studentBId === ex.id) ||
                  (r.studentAId === ex.id && r.studentBId === s.id),
              )
            ) {
              penalty += 9999
            }
          }
        }

        // Prefer Together Bonus
        for (const s of cluster) {
          for (const ex of grp.members) {
            if (
              prefTog.some(
                (r) =>
                  (r.studentAId === s.id && r.studentBId === ex.id) ||
                  (r.studentAId === ex.id && r.studentBId === s.id),
              )
            ) {
              penalty -= 30
            }
          }
        }

        // Gender Balance
        if (options.genderOption === 'balance') {
          const males =
            grp.members.filter((m) => m.gender === 'M').length +
            cluster.filter((m) => m.gender === 'M').length
          const females =
            grp.members.filter((m) => m.gender === 'F').length +
            cluster.filter((m) => m.gender === 'F').length
          penalty += Math.abs(males - females) * 4
        }

        // Academic Hetero
        if (options.academicOption === 'hetero' && grp.members.length > 0) {
          const avg =
            grp.members.reduce((acc, m) => acc + getAcademicScore(m), 0) / grp.members.length
          penalty += Math.abs(avg - 2.0) * 3
        }

        // Engagement Hetero
        if (options.engagementOption === 'hetero') {
          const act =
            grp.members.filter((m) => m.engagement === 'active').length +
            cluster.filter((m) => m.engagement === 'active').length
          const pas =
            grp.members.filter((m) => m.engagement === 'passive').length +
            cluster.filter((m) => m.engagement === 'passive').length
          penalty += Math.abs(act - pas) * 3
        }

        penalty += grp.members.length * 10
        if (penalty < minPenalty) {
          minPenalty = penalty
          bestIdx = idx
        }
      })

      groups[bestIdx].members.push(...cluster)
    })
  } else {
    // Complete Random Shuffle
    clusters.sort(() => Math.random() - 0.5)
    let gIdx = 0
    const maxPerGroup = Math.ceil(students.length / k)
    clusters.forEach((c) => {
      if (groups[gIdx].members.length + c.length > maxPerGroup && gIdx < k - 1) {
        gIdx++
      }
      groups[gIdx].members.push(...c)
    })
  }

  return groups
}
