import { ClipboardCheck, DollarSign, GraduationCap, Handshake, Send } from 'lucide-react'
import type { MonthlyKpis } from '../types/performance'
import { formatCurrency } from '../utils/kpi'
import { KpiCard } from './KpiCard'

type KpiSummaryGridProps = {
  kpis: MonthlyKpis
  monthLabel: string
}

export function KpiSummaryGrid({ kpis, monthLabel }: KpiSummaryGridProps) {
  return (
    <section className="kpi-grid" aria-label={`${monthLabel} KPI summary`}>
      <KpiCard
        title="Sales Won"
        value={formatCurrency(kpis.salesWon)}
        detail={monthLabel}
        icon={<DollarSign size={20} />}
        tone="green"
      />
      <KpiCard
        title="Site Visits Done"
        value={String(kpis.siteVisitsDone)}
        detail="Report sent or later"
        icon={<ClipboardCheck size={20} />}
        tone="blue"
      />
      <KpiCard
        title="Quotes Sent"
        value={String(kpis.quotesSent)}
        detail="Sent, follow up, booked, lost"
        icon={<Send size={20} />}
        tone="indigo"
      />
      <KpiCard
        title="Training Sessions"
        value={String(kpis.trainingSessions)}
        detail="Completed training tasks"
        icon={<GraduationCap size={20} />}
        tone="amber"
      />
      <KpiCard
        title="Consultancy Meetings"
        value={String(kpis.consultancyMeetings)}
        detail="Completed consultancy tasks"
        icon={<Handshake size={20} />}
        tone="teal"
      />
    </section>
  )
}
