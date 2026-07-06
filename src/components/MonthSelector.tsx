import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

type MonthSelectorProps = {
  monthLabel: string
  onPreviousMonth: () => void
  onCurrentMonth: () => void
  onNextMonth: () => void
}

export function MonthSelector({
  monthLabel,
  onPreviousMonth,
  onCurrentMonth,
  onNextMonth,
}: MonthSelectorProps) {
  return (
    <div className="month-selector" aria-label="KPI month selector">
      <button type="button" className="icon-button" aria-label="Previous month" onClick={onPreviousMonth}>
        <ChevronLeft size={20} />
      </button>
      <button type="button" className="month-selector__current" onClick={onCurrentMonth}>
        <CalendarDays size={18} aria-hidden="true" />
        <span>{monthLabel}</span>
      </button>
      <button type="button" className="icon-button" aria-label="Next month" onClick={onNextMonth}>
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
