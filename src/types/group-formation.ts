export type Gender = 'M' | 'F'
export type AcademicLevel = 'high' | 'mid' | 'low'
export type EngagementLevel = 'active' | 'moderate' | 'passive'

export interface Student {
  id: string
  stuNum?: number
  name: string
  gender?: Gender | null
  academicLevel?: AcademicLevel | null
  engagement?: EngagementLevel | null
}

export type RelationshipType = 'mustSeparate' | 'mustTogether' | 'preferTogether'

export interface RelationshipRule {
  id: string
  studentAId: string
  studentBId: string
  type: RelationshipType
}

export interface FormedGroup {
  groupId: number
  groupName: string
  members: Student[]
}

export interface ClassRoom {
  id: string
  name: string
  subject?: string
  students: Student[]
  relationships?: RelationshipRule[]
  /** 현재 확정된 모둠. 없으면 null. */
  activeGroups: FormedGroup[] | null
}

export type GroupMode = 'byCount' | 'bySize'
export type BalanceOption = 'ignore' | 'balance'
export type DiversityOption = 'ignore' | 'hetero' | 'homo'

export interface GroupingOptions {
  groupMode: GroupMode
  targetGroupCount: number
  targetGroupSize: number
  genderOption: BalanceOption
  academicOption: DiversityOption
  engagementOption: DiversityOption
}
