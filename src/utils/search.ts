import type { PerformanceData } from '../types/performance'

export type SearchResult = {
  id: string
  type: 'site_visit' | 'task'
  title: string
  subtitle: string
  status: string
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
    }))

  return [...siteVisitResults, ...taskResults]
}
