import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  KPI_TARGET_DEFINITIONS,
  createDefaultKpiTargets,
  getKpiTargetValue,
  mergeKpiTargets,
} from '../src/utils/kpiTargets.ts'

test('merges an empty KPI target result into complete monthly defaults', () => {
  const targets = mergeKpiTargets([])

  assert.equal(targets.length, KPI_TARGET_DEFINITIONS.length)
  assert.deepEqual(
    targets.map((target) => target.kpi_key),
    KPI_TARGET_DEFINITIONS.map((definition) => definition.kpi_key),
  )
  assert.equal(getKpiTargetValue(targets, 'sales_won'), 100000)
  assert.equal(getKpiTargetValue(targets, 'site_visits_done'), 10)
  assert.ok(targets.every((target) => target.period_type === 'monthly'))
  assert.ok(targets.every((target) => target.is_active))
})

test('merges active monthly Supabase rows while preserving defaults for missing rows', () => {
  const defaults = createDefaultKpiTargets()
  const customSalesTarget = {
    ...defaults.find((target) => target.kpi_key === 'sales_won'),
    id: 'supabase-sales-won',
    target_value: 125000,
  }
  const inactiveQuoteTarget = {
    ...defaults.find((target) => target.kpi_key === 'quotes_sent'),
    id: 'supabase-quotes-sent',
    target_value: 99,
    is_active: false,
  }

  const targets = mergeKpiTargets([customSalesTarget, inactiveQuoteTarget])

  assert.equal(getKpiTargetValue(targets, 'sales_won'), 125000)
  assert.equal(getKpiTargetValue(targets, 'quotes_sent'), 25)
  assert.equal(targets.length, KPI_TARGET_DEFINITIONS.length)
})
