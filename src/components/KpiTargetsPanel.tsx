import { Save } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { KpiTarget, KpiTargetKey } from '../types/performance'
import { KPI_TARGET_DEFINITIONS, getKpiTargetValue } from '../utils/kpiTargets'

type KpiTargetsPanelProps = {
  targets: KpiTarget[]
  onSaveTargets: (targets: KpiTarget[]) => void
}

function buildFormValues(targets: KpiTarget[]) {
  return KPI_TARGET_DEFINITIONS.reduce(
    (values, definition) => ({
      ...values,
      [definition.kpi_key]: String(getKpiTargetValue(targets, definition.kpi_key)),
    }),
    {} as Record<KpiTargetKey, string>,
  )
}

function cleanTargetValue(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function KpiTargetsPanel({ targets, onSaveTargets }: KpiTargetsPanelProps) {
  const [formValues, setFormValues] = useState(() => buildFormValues(targets))

  useEffect(() => {
    setFormValues(buildFormValues(targets))
  }, [targets])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const now = new Date().toISOString()
    const updatedTargets = targets.map((target) => ({
      ...target,
      target_value: cleanTargetValue(formValues[target.kpi_key]),
      updated_at: now,
    }))

    onSaveTargets(updatedTargets)
  }

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <span className="eyebrow">KPI targets</span>
          <h2>Monthly Targets</h2>
        </div>
      </div>

      <form className="target-grid" onSubmit={handleSubmit}>
        {KPI_TARGET_DEFINITIONS.map((definition) => (
          <label key={definition.kpi_key}>
            <span>{definition.kpi_name}</span>
            <input
              min="0"
              name={definition.kpi_key}
              step={definition.unit === 'NZD' ? '1000' : '1'}
              type="number"
              value={formValues[definition.kpi_key]}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  [definition.kpi_key]: event.target.value,
                }))
              }
            />
            <small>{definition.unit}</small>
          </label>
        ))}
        <div className="form-actions span-2">
          <button type="submit" className="primary-button">
            <Save size={18} />
            Save Targets
          </button>
        </div>
      </form>
    </section>
  )
}
