import type { SiteVisitTextAnalysis } from '../types/siteVisitAnalyzer'
import { parseSiteVisitTextLocally } from '../utils/siteVisitTextParser'

const analyzerEndpoint = import.meta.env.VITE_SITE_VISIT_ANALYZER_ENDPOINT?.trim()

const nullableText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

const normalizeConfidence = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(1, value))
}

const normalizeAnalyzerResponse = (value: unknown): SiteVisitTextAnalysis => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawSummary = nullableText(record.rawSummary) ?? 'Analyzer returned extracted site visit details.'

  return {
    customerName: nullableText(record.customerName),
    phone: nullableText(record.phone),
    email: nullableText(record.email),
    address: nullableText(record.address),
    preferredDate: nullableText(record.preferredDate),
    preferredTime: nullableText(record.preferredTime),
    jobId: nullableText(record.jobId),
    notes: nullableText(record.notes),
    confidence: normalizeConfidence(record.confidence),
    rawSummary,
  }
}

async function analyzeWithBackend(endpoint: string, inputText: string): Promise<SiteVisitTextAnalysis> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputText }),
  })

  if (!response.ok) {
    throw new Error(`Analyzer request failed with status ${response.status}.`)
  }

  return normalizeAnalyzerResponse(await response.json())
}

export async function analyzeSiteVisitText(inputText: string): Promise<SiteVisitTextAnalysis> {
  const trimmedText = inputText.trim()

  if (!trimmedText) {
    throw new Error('Paste inquiry text before analyzing.')
  }

  if (analyzerEndpoint) {
    // The backend endpoint owns any OpenAI credentials. The browser only sends inquiry text.
    return analyzeWithBackend(analyzerEndpoint, trimmedText)
  }

  return parseSiteVisitTextLocally(trimmedText)
}
