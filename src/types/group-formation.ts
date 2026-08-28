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

export interface ArchivedGroupSet {
  id: string
  title: string
  createdAt: string
  groups: FormedGroup[]
}

export interface ClassRoom {
  id: string
  name: string
  subject?: string
  students: Student[]
  activeGroupSet: ArchivedGroupSet | null
  archivedGroupSets: ArchivedGroupSet[]
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
