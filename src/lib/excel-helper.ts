import ExcelJS from 'exceljs'
import type { AcademicLevel, EngagementLevel, Gender, Student } from '@/types/group-formation'

/**
 * Downloads a sample Excel (.xlsx) file template with dropdown validation for gender, academicLevel, and engagement.
 */
export async function downloadSampleCsvTemplate() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'GroupTalk'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('학생명단', {
    views: [{ showGridLines: true }],
  })

  // Define columns
  worksheet.columns = [
    { header: '번호', key: 'num', width: 10 },
    { header: '학생명(필수)', key: 'name', width: 18 },
    { header: '성별(선택)', key: 'gender', width: 16 },
    { header: '학업수준(선택)', key: 'academic', width: 18 },
    { header: '참여·발화(선택)', key: 'engagement', width: 18 },
  ]

  // Header styling
  const headerRow = worksheet.getRow(1)
  headerRow.height = 28
  headerRow.eachCell((cell) => {
    cell.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }, // Indigo / Primary
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  })

  // Sample student data
  const sampleData = [
    { num: 1, name: '김민준', gender: '남', academic: '상', engagement: '적극' },
    { num: 2, name: '이지은', gender: '여', academic: '중', engagement: '보통' },
    { num: 3, name: '박서준', gender: '남', academic: '하', engagement: '소극' },
    { num: 4, name: '최수빈', gender: '여', academic: '중', engagement: '보통' },
    { num: 5, name: '정예원', gender: '여', academic: '상', engagement: '적극' },
  ]

  sampleData.forEach((row) => {
    worksheet.addRow(row)
  })

  // Setup dropdown data validations for rows 2 to 100
  for (let rowIdx = 2; rowIdx <= 100; rowIdx++) {
    const row = worksheet.getRow(rowIdx)
    row.height = 22

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: '맑은 고딕', size: 10 }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      }
    })

    // Alignments
    row.getCell('num').alignment = { vertical: 'middle', horizontal: 'center' }
    row.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' }
    row.getCell('gender').alignment = { vertical: 'middle', horizontal: 'center' }
    row.getCell('academic').alignment = { vertical: 'middle', horizontal: 'center' }
    row.getCell('engagement').alignment = { vertical: 'middle', horizontal: 'center' }

    // Dropdown for Gender (Column C)
    const genderCell = row.getCell('gender')
    genderCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"남,여"'],
      showErrorMessage: true,
      errorTitle: '성별 선택',
      error: '목록에서 남 또는 여를 선택해주세요.',
    }

    // Dropdown for Academic Level (Column D)
    const academicCell = row.getCell('academic')
    academicCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"상,중,하"'],
      showErrorMessage: true,
      errorTitle: '학업수준 선택',
      error: '목록에서 상, 중, 하 중 하나를 선택해주세요.',
    }

    // Dropdown for Engagement Level (Column E)
    const engagementCell = row.getCell('engagement')
    engagementCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"적극,보통,소극"'],
      showErrorMessage: true,
      errorTitle: '참여·발화 선택',
      error: '목록에서 적극, 보통, 소극 중 하나를 선택해주세요.',
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '학급_학생명단_양식.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Parses uploaded Excel (.xlsx, .xls) or CSV/TXT files into Student objects.
 */
export async function parseStudentFile(file: File): Promise<Student[]> {
  const students: Student[] = []

  // 1. If XLSX or XLS, parse with ExcelJS
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(arrayBuffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return students

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return // Skip header row

      const c1 = row.getCell(1).text?.trim()
      const c2 = row.getCell(2).text?.trim()
      const c3 = row.getCell(3).text?.trim()
      const c4 = row.getCell(4).text?.trim()
      const c5 = row.getCell(5).text?.trim()

      let stuNum: number | undefined
      let name = ''
      let gRaw = ''
      let aRaw = ''
      let eRaw = ''

      if (!isNaN(Number(c1)) && c2) {
        stuNum = Number(c1)
        name = c2
        gRaw = c3
        aRaw = c4
        eRaw = c5
      } else {
        name = c1 || c2
        gRaw = c2 || c3
        aRaw = c3 || c4
        eRaw = c4 || c5
      }

      if (!name) return

      let gender: Gender | null = null
      if (gRaw.includes('남') || gRaw.toUpperCase() === 'M') gender = 'M'
      else if (gRaw.includes('여') || gRaw.toUpperCase() === 'F') gender = 'F'

      let academicLevel: AcademicLevel | null = null
      if (aRaw.includes('상') || aRaw.toUpperCase() === 'HIGH') academicLevel = 'high'
      else if (aRaw.includes('중') || aRaw.toUpperCase() === 'MID') academicLevel = 'mid'
      else if (aRaw.includes('하') || aRaw.toUpperCase() === 'LOW') academicLevel = 'low'

      let engagement: EngagementLevel | null = null
      if (eRaw.includes('적극') || eRaw.toUpperCase() === 'ACTIVE') engagement = 'active'
      else if (eRaw.includes('보통') || eRaw.toUpperCase() === 'MODERATE') engagement = 'moderate'
      else if (eRaw.includes('소극') || eRaw.toUpperCase() === 'PASSIVE') engagement = 'passive'

      students.push({
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        stuNum: stuNum ?? students.length + 1,
        name,
        gender,
        academicLevel,
        engagement,
      })
    })

    return students
  }

  // 2. If CSV or TXT file
  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // Skip header if it contains header keywords
    if (i === 0 && (line.includes('학생명') || line.includes('이름') || line.includes('name'))) {
      continue
    }

    const cols = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''))
    if (cols.length === 0 || !cols[0]) continue

    let stuNum: number | undefined
    let name = ''
    let gRaw = ''
    let aRaw = ''
    let eRaw = ''

    if (cols.length >= 2 && !isNaN(Number(cols[0]))) {
      stuNum = Number(cols[0])
      name = cols[1] || ''
      gRaw = cols[2] || ''
      aRaw = cols[3] || ''
      eRaw = cols[4] || ''
    } else {
      stuNum = i + 1
      name = cols[0] || ''
      gRaw = cols[1] || ''
      aRaw = cols[2] || ''
      eRaw = cols[3] || ''
    }

    if (!name) continue

    let gender: Gender | null = null
    if (gRaw.includes('남') || gRaw.toUpperCase() === 'M') gender = 'M'
    else if (gRaw.includes('여') || gRaw.toUpperCase() === 'F') gender = 'F'

    let academicLevel: AcademicLevel | null = null
    if (aRaw.includes('상') || aRaw.toUpperCase() === 'HIGH') academicLevel = 'high'
    else if (aRaw.includes('중') || aRaw.toUpperCase() === 'MID') academicLevel = 'mid'
    else if (aRaw.includes('하') || aRaw.toUpperCase() === 'LOW') academicLevel = 'low'

    let engagement: EngagementLevel | null = null
    if (eRaw.includes('적극') || eRaw.toUpperCase() === 'ACTIVE') engagement = 'active'
    else if (eRaw.includes('보통') || eRaw.toUpperCase() === 'MODERATE') engagement = 'moderate'
    else if (eRaw.includes('소극') || eRaw.toUpperCase() === 'PASSIVE') engagement = 'passive'

    students.push({
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      stuNum,
      name,
      gender,
      academicLevel,
      engagement,
    })
  }

  return students
}

export function parseTextRoster(text: string): Student[] {
  const students: Student[] = []
  if (!text || !text.trim()) return students

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return

    // If comma-separated in one line with multiple names
    if (trimmed.includes(',') && !trimmed.match(/^\d+[, ]/)) {
      const names = trimmed.split(',').map((n) => n.trim()).filter(Boolean)
      names.forEach((name) => {
        students.push({
          id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          stuNum: students.length + 1,
          name,
          gender: null,
          academicLevel: null,
          engagement: null,
        })
      })
      return
    }

    // Tokenize line by comma or whitespace
    const tokens = trimmed.includes(',')
      ? trimmed.split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : trimmed.split(/\s+/).filter(Boolean)

    if (tokens.length === 0) return

    let stuNum: number | undefined
    let name = ''
    let gender: Gender | null = null
    let academicLevel: AcademicLevel | null = null
    let engagement: EngagementLevel | null = null

    tokens.forEach((token) => {
      // 1. Number check
      if (!stuNum && /^\d+$/.test(token) && !name) {
        stuNum = Number(token)
        return
      }

      // 2. Gender check
      if (!gender && (token === '남' || token === '남성' || token.toUpperCase() === 'M' || token.startsWith('남('))) {
        gender = 'M'
        return
      }
      if (!gender && (token === '여' || token === '여성' || token.toUpperCase() === 'F' || token.startsWith('여('))) {
        gender = 'F'
        return
      }

      // 3. Academic Level check
      if (!academicLevel && (token === '상' || token.toUpperCase() === 'HIGH')) {
        academicLevel = 'high'
        return
      }
      if (!academicLevel && (token === '중' || token.toUpperCase() === 'MID')) {
        academicLevel = 'mid'
        return
      }
      if (!academicLevel && (token === '하' || token.toUpperCase() === 'LOW')) {
        academicLevel = 'low'
        return
      }

      // 4. Engagement Level check
      if (!engagement && (token === '적극' || token.toUpperCase() === 'ACTIVE')) {
        engagement = 'active'
        return
      }
      if (!engagement && (token === '보통' || token.toUpperCase() === 'MODERATE')) {
        engagement = 'moderate'
        return
      }
      if (!engagement && (token === '소극' || token.toUpperCase() === 'PASSIVE')) {
        engagement = 'passive'
        return
      }

      // 5. Name check
      if (!name) {
        name = token
      }
    })

    if (name) {
      students.push({
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        stuNum: stuNum ?? students.length + 1,
        name,
        gender,
        academicLevel,
        engagement: engagement ?? null,
      })
    }
  })

  return students
}
