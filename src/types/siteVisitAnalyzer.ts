export type SiteVisitTextAnalysis = {
  customerName: string | null
  phone: string | null
  email: string | null
  address: string | null
  preferredDate: string | null
  preferredTime: string | null
  jobId: string | null
  notes: string | null
  confidence: number
  rawSummary: string
}

export type SiteVisitPrefillOutcome = {
  appliedFields: string[]
  skippedFields: string[]
}

export type SiteVisitPrefillRequest = {
  id: number
  analysis: SiteVisitTextAnalysis
}
