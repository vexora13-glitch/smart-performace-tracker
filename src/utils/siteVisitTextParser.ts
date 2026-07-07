import type { SiteVisitTextAnalysis } from '../types/siteVisitAnalyzer'

const monthNumbers: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

const weekdayNumbers: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const streetPattern =
  /\b\d{1,5}\s+(?:[A-Za-z0-9'.-]+\s+){0,8}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|place|pl|crescent|cres|court|ct|way|terrace|tce|highway|hwy)\b[^\n,;.]*/i

type ParsedFieldLine = {
  label: string
  normalizedLabel: string
  value: string
}

const emptyAnalysis = (rawSummary: string): SiteVisitTextAnalysis => ({
  customerName: null,
  phone: null,
  email: null,
  address: null,
  preferredDate: null,
  preferredTime: null,
  jobId: null,
  notes: null,
  confidence: 0,
  rawSummary,
})

const formatDateInput = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const normalizeLines = (text: string) =>
  text
    .split(/\r?\n|[;•]/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)

const cleanValue = (value: string) =>
  normalizeWhitespace(value)
    .replace(/^["'“”]+|["'“”.,]+$/g, '')
    .replace(/^\s*#/, '')
    .trim()

const getLineValue = (lines: string[], labelPattern: RegExp) => {
  for (const line of lines) {
    const match = line.match(labelPattern)

    if (match?.[1]) {
      return cleanValue(match[1])
    }
  }

  return null
}

const normalizeFieldLabel = (value: string) => value.replace(/\*/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()

const parseFieldLine = (line: string): ParsedFieldLine | null => {
  const match = line.match(/^\s*([A-Za-z][A-Za-z\s/*().&'-]{0,80}?)\s*\*?\s*[:=-]\s*(.*)$/)

  if (!match) {
    return null
  }

  const label = normalizeWhitespace(match[1].replace(/\*/g, ''))

  return {
    label,
    normalizedLabel: normalizeFieldLabel(label),
    value: cleanValue(match[2] ?? ''),
  }
}

const labelMatches = (normalizedLabel: string, labels: string[]) =>
  labels.some((label) => normalizedLabel === normalizeFieldLabel(label))

const getFieldValues = (lines: string[], labels: string[]) => {
  const values: string[] = []

  lines.forEach((line, index) => {
    const parsedLine = parseFieldLine(line)

    if (!parsedLine || !labelMatches(parsedLine.normalizedLabel, labels)) {
      return
    }

    if (parsedLine.value) {
      values.push(parsedLine.value)
      return
    }

    const valueParts: string[] = []
    let nextIndex = index + 1

    while (nextIndex < lines.length && !parseFieldLine(lines[nextIndex])) {
      valueParts.push(cleanValue(lines[nextIndex]))
      nextIndex += 1
    }

    const value = cleanValue(valueParts.join(' '))

    if (value) {
      values.push(value)
    }
  })

  return values
}

const getFirstFieldValue = (lines: string[], labels: string[]) => getFieldValues(lines, labels)[0] ?? null

const validDate = (year: number, monthIndex: number, day: number) => {
  const date = new Date(year, monthIndex, day)

  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return null
  }

  return date
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const nextWeekday = (baseDate: Date, targetDay: number, mustBeFuture: boolean) => {
  const currentDay = baseDate.getDay()
  let offset = (targetDay - currentDay + 7) % 7

  if (offset === 0 && mustBeFuture) {
    offset = 7
  }

  return addDays(baseDate, offset)
}

const parseMeridiemTime = (hourText: string, minuteText: string | undefined, meridiem: string) => {
  let hour = Number(hourText)
  const minute = minuteText ? Number(minuteText) : 0
  const normalizedMeridiem = meridiem.toLowerCase().replace(/\./g, '')

  if (hour < 1 || hour > 12 || minute > 59) {
    return null
  }

  if (normalizedMeridiem === 'pm' && hour !== 12) {
    hour += 12
  }

  if (normalizedMeridiem === 'am' && hour === 12) {
    hour = 0
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const parseTime = (text: string) => {
  const meridiemMatch = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap]\.?m\.?)\b/i)

  if (meridiemMatch) {
    return {
      preferredTime: parseMeridiemTime(meridiemMatch[1], meridiemMatch[2], meridiemMatch[3]),
      vagueTimePhrase: null,
    }
  }

  const twentyFourHourMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)

  if (twentyFourHourMatch) {
    return {
      preferredTime: `${String(Number(twentyFourHourMatch[1])).padStart(2, '0')}:${twentyFourHourMatch[2]}`,
      vagueTimePhrase: null,
    }
  }

  if (/\b(?:noon|midday)\b/i.test(text)) {
    return {
      preferredTime: '12:00',
      vagueTimePhrase: null,
    }
  }

  const vagueMatch = text.match(
    /\b(?:(?:today|tomorrow|next\s+)?(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s+)?(?:morning|afternoon|evening|tonight|lunchtime|around lunch|after lunch|before lunch|business hours)\b/i,
  )

  return {
    preferredTime: null,
    vagueTimePhrase: vagueMatch ? cleanValue(vagueMatch[0]) : null,
  }
}

const parseDate = (text: string, baseDate: Date) => {
  const isoMatch = text.match(/\b(20\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/)

  if (isoMatch) {
    const date = validDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    return date ? { preferredDate: formatDateInput(date), vagueDatePhrase: null } : { preferredDate: null, vagueDatePhrase: isoMatch[0] }
  }

  const numericMatch = text.match(/\b([0-3]?\d)[/-]([01]?\d)[/-]((?:20)?\d{2})\b/)

  if (numericMatch) {
    const yearNumber = Number(numericMatch[3])
    const year = yearNumber < 100 ? 2000 + yearNumber : yearNumber
    const first = Number(numericMatch[1])
    const second = Number(numericMatch[2])
    const dayFirstDate = validDate(year, second - 1, first)
    const monthFirstDate = validDate(year, first - 1, second)
    const date = dayFirstDate ?? monthFirstDate

    return date
      ? { preferredDate: formatDateInput(date), vagueDatePhrase: null }
      : { preferredDate: null, vagueDatePhrase: numericMatch[0] }
  }

  const dayMonthMatch = text.match(
    /\b(?:(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?),?\s+)?([0-3]?\d)(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(20\d{2}))?\b/i,
  )

  if (dayMonthMatch) {
    const weekday = dayMonthMatch[1]?.toLowerCase()
    const day = Number(dayMonthMatch[2])
    const month = monthNumbers[dayMonthMatch[3].toLowerCase()]
    const year = dayMonthMatch[4] ? Number(dayMonthMatch[4]) : baseDate.getFullYear()
    const date = validDate(year, month, day)

    if (!date) {
      return { preferredDate: null, vagueDatePhrase: dayMonthMatch[0] }
    }

    if (weekday && date.getDay() !== weekdayNumbers[weekday]) {
      return { preferredDate: null, vagueDatePhrase: dayMonthMatch[0] }
    }

    return { preferredDate: formatDateInput(date), vagueDatePhrase: null }
  }

  const monthDayMatch = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i,
  )

  if (monthDayMatch) {
    const month = monthNumbers[monthDayMatch[1].toLowerCase()]
    const day = Number(monthDayMatch[2])
    const year = monthDayMatch[3] ? Number(monthDayMatch[3]) : baseDate.getFullYear()
    const date = validDate(year, month, day)

    return date ? { preferredDate: formatDateInput(date), vagueDatePhrase: null } : { preferredDate: null, vagueDatePhrase: monthDayMatch[0] }
  }

  if (/\btomorrow\b/i.test(text)) {
    return { preferredDate: formatDateInput(addDays(baseDate, 1)), vagueDatePhrase: null }
  }

  if (/\btoday\b/i.test(text)) {
    return { preferredDate: formatDateInput(baseDate), vagueDatePhrase: null }
  }

  const nextWeekdayMatch = text.match(
    /\bnext\s+(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
  )

  if (nextWeekdayMatch) {
    return {
      preferredDate: formatDateInput(nextWeekday(baseDate, weekdayNumbers[nextWeekdayMatch[1].toLowerCase()], true)),
      vagueDatePhrase: null,
    }
  }

  const weekdayMatch = text.match(
    /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
  )

  if (weekdayMatch) {
    return {
      preferredDate: formatDateInput(nextWeekday(baseDate, weekdayNumbers[weekdayMatch[1].toLowerCase()], false)),
      vagueDatePhrase: null,
    }
  }

  const vagueMatch = text.match(/\b(?:as soon as possible|asap|this week|next week|soon|when available)\b/i)

  return { preferredDate: null, vagueDatePhrase: vagueMatch ? cleanValue(vagueMatch[0]) : null }
}

const extractEmail = (text: string) => text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null

const extractIdFromFieldValue = (value: string) => value.match(/^#?[A-Z0-9][A-Z0-9_./-]{1,}\b/i)?.[0] ?? null

const extractJobId = (lines: string[], text: string) =>
  getFieldValues(lines, ['Job ID', 'Booking ID', 'Inquiry ID', 'Reference', 'Ref']).map(extractIdFromFieldValue).find(Boolean) ??
  getLineValue(lines, /^\s*(?:job\s*id|booking\s*id|inquiry\s*id|ref(?:erence)?\.?)\s*[:#=-]?\s*(#?[A-Z0-9][A-Z0-9_./-]{1,})\b/i) ??
  text.match(/\b(?:job\s*id|booking\s*id|inquiry\s*id|ref(?:erence)?\.?)\s*[:#=-]?\s*(#?[A-Z0-9][A-Z0-9_./-]{1,})\b/i)?.[1] ??
  null

const extractPhone = (lines: string[], text: string) => {
  const labeledPhone =
    getFirstFieldValue(lines, ['Phone', 'Mobile', 'Contact Number', 'Tel']) ??
    getLineValue(lines, /^\s*(?:phone|mobile|contact\s*number|tel)\s*[:=-]\s*(.+)$/i)

  if (labeledPhone) {
    return labeledPhone
  }

  const candidates = [...text.matchAll(/(?<!\w)(?:\+?\d[\d\s().-]{6,}\d)(?!\w)/g)]
    .map((match) => cleanValue(match[0]))
    .filter((candidate) => {
      const digitCount = candidate.replace(/\D/g, '').length
      const looksLikeDate = /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(candidate)
      return digitCount >= 7 && !looksLikeDate
    })

  return candidates[0] ?? null
}

const extractCustomerName = (lines: string[]) => {
  const firstName = getFirstFieldValue(lines, ['First Name'])
  const surname = getFirstFieldValue(lines, ['Surname', 'Last Name'])

  if (firstName && surname) {
    return cleanValue(`${firstName} ${surname}`)
  }

  return (
    getFirstFieldValue(lines, ['Customer Name', 'Client Name', 'Customer']) ??
    getFirstFieldValue(lines, ['Name']) ??
    getFirstFieldValue(lines, ['Destination Contact Name'])
  )
}

const extractAddress = (lines: string[], text: string) =>
  getFirstFieldValue(lines, ['Pick Up Address', 'Pickup Address', 'Pick-up Address']) ??
  getFirstFieldValue(lines, ['Site Address', 'Visit Address']) ??
  getFirstFieldValue(lines, ['Delivery Address', 'Destination Address']) ??
  getFirstFieldValue(lines, ['Address']) ??
  text.match(streetPattern)?.[0] ??
  null

const extractNotes = (lines: string[]) => {
  const meaninglessNotePattern = /^(?:no|none|n\/a|na|nil|no\s+(?:access|settlement|house)\s+notes?)$/i
  const notes = getFieldValues(lines, ['Client Notes', 'Sales Notes', 'Access Notes', 'Settlement Notes', 'House Notes'])
    .map(cleanValue)
    .filter((value) => value && !meaninglessNotePattern.test(value))

  return [...new Set(notes)]
}

const excludedScheduleLabels = ['Move Date', 'Date of Move', 'Moving Date', 'Move Time', 'Time Requested', 'Time (requested)', 'Requested Time']

const stripMoveScheduleFields = (lines: string[]) => {
  const includedLines: string[] = []
  let skipNextValueLine = false

  lines.forEach((line) => {
    if (skipNextValueLine) {
      if (!parseFieldLine(line)) {
        skipNextValueLine = false
        return
      }

      skipNextValueLine = false
    }

    const parsedLine = parseFieldLine(line)

    if (parsedLine && labelMatches(parsedLine.normalizedLabel, excludedScheduleLabels)) {
      skipNextValueLine = !parsedLine.value
      return
    }

    includedLines.push(line)
  })

  return includedLines.join(' ')
}

const siteVisitPhrasePriority = (text: string) => {
  if (/\bsite\s+visit\s+booked\s+for\b/i.test(text)) {
    return 0
  }

  if (/\bsite\s+visit\s+booked\b/i.test(text)) {
    return 1
  }

  if (/\bsite\s+visit\s+scheduled\b/i.test(text)) {
    return 2
  }

  if (/\bsite\s+visit\s+appointment\b/i.test(text)) {
    return 3
  }

  if (/\bsite\s+visit\b/i.test(text)) {
    return 4
  }

  return null
}

const siteVisitScheduleCandidates = (lines: string[]) => {
  const candidates: Array<{ text: string; priority: number; index: number }> = []

  getFieldValues(lines, ['Sales Notes']).forEach((value, index) => {
    const priority = siteVisitPhrasePriority(value)

    if (priority !== null) {
      candidates.push({ text: value, priority, index: index - 1000 })
    }
  })

  lines.forEach((line, index) => {
    const priority = siteVisitPhrasePriority(line)

    if (priority === null) {
      return
    }

    candidates.push({ text: line, priority, index })

    const nextLine = lines[index + 1]
    if (nextLine && !parseFieldLine(nextLine)) {
      candidates.push({ text: `${line} ${nextLine}`, priority, index })
    }
  })

  return candidates.sort((left, right) => left.priority - right.priority || left.index - right.index)
}

const parseScheduleFromCandidates = (candidates: Array<{ text: string }>, baseDate: Date) => {
  for (const candidate of candidates) {
    const dateResult = parseDate(candidate.text, baseDate)
    const timeResult = parseTime(candidate.text)

    if (dateResult.preferredDate || timeResult.preferredTime) {
      return {
        preferredDate: dateResult.preferredDate,
        preferredTime: timeResult.preferredTime,
        vagueDatePhrase: dateResult.vagueDatePhrase,
        vagueTimePhrase: timeResult.vagueTimePhrase,
      }
    }
  }

  return null
}

const parsePreferredSchedule = (lines: string[], baseDate: Date) => {
  const siteVisitSchedule = parseScheduleFromCandidates(siteVisitScheduleCandidates(lines), baseDate)
  const fallbackText = stripMoveScheduleFields(lines)
  const fallbackDate = siteVisitSchedule?.preferredDate ? null : parseDate(fallbackText, baseDate)
  const fallbackTime = siteVisitSchedule?.preferredTime ? null : parseTime(fallbackText)

  return {
    preferredDate: siteVisitSchedule?.preferredDate ?? fallbackDate?.preferredDate ?? null,
    preferredTime: siteVisitSchedule?.preferredTime ?? fallbackTime?.preferredTime ?? null,
    vagueDatePhrase: siteVisitSchedule?.vagueDatePhrase ?? fallbackDate?.vagueDatePhrase ?? null,
    vagueTimePhrase: siteVisitSchedule?.vagueTimePhrase ?? fallbackTime?.vagueTimePhrase ?? null,
  }
}

const buildNotes = (noteParts: string[]) => {
  const cleanedNotes = noteParts.map(cleanValue).filter(Boolean)
  return cleanedNotes.length ? [...new Set(cleanedNotes)].join('\n') : null
}

const buildRawSummary = (analysis: Omit<SiteVisitTextAnalysis, 'confidence' | 'rawSummary'>) => {
  const summaryParts = [
    analysis.customerName ? `Customer: ${analysis.customerName}` : null,
    analysis.phone ? `Phone: ${analysis.phone}` : null,
    analysis.email ? `Email: ${analysis.email}` : null,
    analysis.address ? `Address: ${analysis.address}` : null,
    analysis.preferredDate ? `Date: ${analysis.preferredDate}` : null,
    analysis.preferredTime ? `Time: ${analysis.preferredTime}` : null,
    analysis.jobId ? `Job ID: ${analysis.jobId}` : null,
  ].filter((part): part is string => Boolean(part))

  return summaryParts.length ? summaryParts.join(' | ') : 'No structured details found.'
}

const calculateConfidence = (analysis: Omit<SiteVisitTextAnalysis, 'confidence' | 'rawSummary'>) => {
  const extractedFields = [
    analysis.customerName,
    analysis.phone,
    analysis.email,
    analysis.address,
    analysis.preferredDate,
    analysis.preferredTime,
    analysis.jobId,
    analysis.notes,
  ].filter(Boolean).length

  return Math.min(0.95, Number((extractedFields / 8).toFixed(2)))
}

export function parseSiteVisitTextLocally(inputText: string, baseDate = new Date()): SiteVisitTextAnalysis {
  const text = inputText.trim()

  if (!text) {
    return emptyAnalysis('No inquiry text was provided.')
  }

  const lines = normalizeLines(text)
  const { preferredDate, preferredTime, vagueDatePhrase, vagueTimePhrase } = parsePreferredSchedule(lines, baseDate)
  const noteParts = extractNotes(lines)

  if (vagueDatePhrase || vagueTimePhrase) {
    noteParts.push(`Unapplied date/time phrase: ${[vagueDatePhrase, vagueTimePhrase].filter(Boolean).join(' ')}`)
  }

  const extracted = {
    customerName: extractCustomerName(lines),
    phone: extractPhone(lines, text),
    email: extractEmail(text),
    address: extractAddress(lines, text),
    preferredDate,
    preferredTime,
    jobId: extractJobId(lines, text),
    notes: buildNotes(noteParts),
  }

  return {
    ...extracted,
    confidence: calculateConfidence(extracted),
    rawSummary: buildRawSummary(extracted),
  }
}
