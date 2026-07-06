import type { PerformanceData } from '../types/performance'

export type SearchResult = {
  id: string
  type: 'site_visit' | 'task' | 'booking' | 'quote'
  title: string
  subtitle: string
  status: string
  siteVisitId?: string | null
}

const includesQuery = (value: string | null | undefined, query: string) =>
  value?.toLowerCase().includes(query) ?? false

export function searchPerformanceData(data: PerformanceData, rawQuery: string): SearchResult[] {
  const query = rawQuery.trim().toLowerCase()

  if (!query) {
    return []
  }

  const siteVisitResults = data.siteVisits
    .filter(
      (siteVisit) =>
        includesQuery(siteVisit.reference_number, query) ||
        includesQuery(siteVisit.customer_full_name, query) ||
        includesQuery(siteVisit.suburb, query) ||
        includesQuery(siteVisit.contact_number, query),
    )
    .map((siteVisit) => ({
      id: siteVisit.id,
      type: 'site_visit' as const,
      title: `${siteVisit.reference_number} - ${siteVisit.customer_full_name}`,
      subtitle: `${siteVisit.suburb} - ${siteVisit.contact_number}`,
      status: siteVisit.status,
    }))

  const taskResults = data.tasks
    .filter((task) => includesQuery(task.title, query))
    .map((task) => ({
      id: task.id,
      type: 'task' as const,
      title: task.title,
      subtitle: task.task_type,
      status: task.status,
      siteVisitId: task.site_visit_id,
    }))

  const bookingResults = data.bookings
    .filter((booking) => includesQuery(booking.booking_number, query) || includesQuery(booking.customer_full_name, query))
    .map((booking) => ({
      id: booking.id,
      type: 'booking' as const,
      title: `${booking.booking_number} - ${booking.customer_full_name}`,
      subtitle: booking.booking_source === 'Manual' ? 'Manual Booking' : 'Workflow Booking',
      status: booking.verification_status,
      siteVisitId: booking.site_visit_id,
    }))

  const quoteResults = data.quotes
    .filter((quote) => includesQuery(quote.quote_reference, query) || includesQuery(quote.customer_full_name, query))
    .map((quote) => ({
      id: quote.id,
      type: 'quote' as const,
      title: `${quote.quote_reference} - ${quote.customer_full_name}`,
      subtitle: quote.quote_value ? `Quote value ${quote.quote_value}` : 'Quote',
      status: quote.status,
      siteVisitId: quote.site_visit_id,
    }))

  return [...siteVisitResults, ...taskResults, ...bookingResults, ...quoteResults]
}
