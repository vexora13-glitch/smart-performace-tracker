import type { SiteVisitTextAnalysis, SiteVisitPrefillOutcome } from '../types/siteVisitAnalyzer'

export type SiteVisitPrefillFormState = {
  customer_full_name: string
  contact_number: string
  email: string
  address: string
  booked_date: string
  booked_time: string
  job_id: string
  notes: string
}

type PrefillField = keyof SiteVisitPrefillFormState

const fieldLabels: Record<PrefillField, string> = {
  customer_full_name: 'Customer name',
  contact_number: 'Contact number',
  email: 'Email',
  address: 'Address',
  booked_date: 'Date',
  booked_time: 'Time',
  job_id: 'Job ID',
  notes: 'Notes',
}

const cleanText = (value: string | null) => value?.trim() ?? ''

const prefillValueEntries = (analysis: SiteVisitTextAnalysis): Array<[PrefillField, string]> =>
  [
    ['customer_full_name', cleanText(analysis.customerName)],
    ['contact_number', cleanText(analysis.phone)],
    ['email', cleanText(analysis.email)],
    ['address', cleanText(analysis.address)],
    ['booked_date', cleanText(analysis.preferredDate)],
    ['booked_time', cleanText(analysis.preferredTime)],
    ['job_id', cleanText(analysis.jobId)],
    ['notes', cleanText(analysis.notes)],
  ].filter((entry): entry is [PrefillField, string] => Boolean(entry[1]))

const mergeNotes = (currentNotes: string, nextNotes: string) => {
  if (!currentNotes.trim()) {
    return nextNotes
  }

  if (currentNotes.includes(nextNotes)) {
    return currentNotes
  }

  return `${currentNotes.trim()}\n\nAI notes: ${nextNotes}`
}

export function mergeSiteVisitAnalysisIntoForm<T extends SiteVisitPrefillFormState>(
  currentForm: T,
  analysis: SiteVisitTextAnalysis,
): { form: T; outcome: SiteVisitPrefillOutcome } {
  const nextForm = { ...currentForm }
  const appliedFields: string[] = []
  const skippedFields: string[] = []

  for (const [field, value] of prefillValueEntries(analysis)) {
    const currentValue = currentForm[field].trim()

    if (field === 'notes') {
      nextForm.notes = mergeNotes(currentForm.notes, value)
      appliedFields.push(fieldLabels[field])
      continue
    }

    if (!currentValue) {
      nextForm[field] = value
      appliedFields.push(fieldLabels[field])
      continue
    }

    if (currentValue !== value) {
      skippedFields.push(fieldLabels[field])
    }
  }

  return {
    form: nextForm,
    outcome: {
      appliedFields,
      skippedFields,
    },
  }
}
