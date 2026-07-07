import type { KpiTarget, KpiTargetKey } from '../types/performance'

export const KPI_TARGET_DEFINITIONS: Array<Pick<KpiTarget, 'kpi_key' | 'kpi_name' | 'target_value' | 'unit'>> = [
  { kpi_key: 'sales_won', kpi_name: 'Sales Won', target_value: 100000, unit: 'NZD' },
  { kpi_key: 'site_visits_done', kpi_name: 'Site Visits Done', target_value: 10, unit: 'count' },
  { kpi_key: 'quotes_sent', kpi_name: 'Quotes Sent', target_value: 25, unit: 'count' },
  { kpi_key: 'bookings_won', kpi_name: 'Bookings Won', target_value: 10, unit: 'count' },
  { kpi_key: 'training_sessions', kpi_name: 'Training Sessions', target_value: 4, unit: 'count' },
  { kpi_key: 'consultancy_meetings', kpi_name: 'Consultancy Meetings', target_value: 4, unit: 'count' },
]

const targetKeySet = new Set<KpiTargetKey>(KPI_TARGET_DEFINITIONS.map((definition) => definition.kpi_key))

export function createDefaultKpiTargets(): KpiTarget[] {
  const now = new Date().toISOString()

  return KPI_TARGET_DEFINITIONS.map((definition) => ({
    id: `default-${definition.kpi_key}`,
    owner_user_id: null,
    ...definition,
    period_type: 'monthly',
    is_active: true,
    created_at: now,
    updated_at: now,
  }))
}

export function mergeKpiTargets(records: KpiTarget[]) {
  const defaults = createDefaultKpiTargets()
  const byKey = new Map<KpiTargetKey, KpiTarget>(defaults.map((target) => [target.kpi_key, target]))

  records.forEach((record) => {
    if (targetKeySet.has(record.kpi_key) && record.period_type === 'monthly' && record.is_active) {
      byKey.set(record.kpi_key, record)
    }
  })

  return KPI_TARGET_DEFINITIONS.map((definition) => byKey.get(definition.kpi_key) ?? defaults[0])
}

export function getKpiTargetValue(targets: KpiTarget[], key: KpiTargetKey) {
  return targets.find((target) => target.kpi_key === key)?.target_value ?? 0
}
