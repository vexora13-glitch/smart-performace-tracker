import {
  AlertTriangle,
  BadgeCheck,
  CalendarCheck,
  ClipboardCheck,
  DollarSign,
  GraduationCap,
  Handshake,
  Send,
  TrendingUp,
} from 'lucide-react'
import type { KpiTarget, MonthlyKpis } from '../types/performance'
import { formatCurrency } from '../utils/kpi'
import { getKpiTargetValue } from '../utils/kpiTargets'
import { KpiCard } from './KpiCard'

type KpiSummaryGridProps = {
  kpis: MonthlyKpis
  targets: KpiTarget[]
  monthLabel: string
}

function getCountTone(value: number, target: number) {
  if (value <= 0) {
    return 'gray'
  }

  return target > 0 && value >= target ? 'green' : 'blue'
}

function getSalesProgressTone(value: number, target: number) {
  if (value <= 0) {
    return 'gray'
  }

  return target > 0 && value >= target ? 'green' : 'blue'
}

function countDetail(value: number, target: number) {
  return target > 0 ? `${value} / ${target} target` : `${value} completed`
}

export function KpiSummaryGrid({ kpis, targets, monthLabel }: KpiSummaryGridProps) {
  const salesTarget = getKpiTargetValue(targets, 'sales_won')
  const siteVisitTarget = getKpiTargetValue(targets, 'site_visits_done')
  const quoteTarget = getKpiTargetValue(targets, 'quotes_sent')
  const bookingTarget = getKpiTargetValue(targets, 'bookings_won')
  const trainingTarget = getKpiTargetValue(targets, 'training_sessions')
  const consultancyTarget = getKpiTargetValue(targets, 'consultancy_meetings')
  const needsReview = kpis.mismatchBookingCount > 0 || kpis.notFoundBookingCount > 0

  return (
    <div className="kpi-summary-stack">
      <section className="kpi-grid" aria-label={`${monthLabel} KPI summary`}>
        <KpiCard
          title="Estimated Sales Won"
          value={formatCurrency(kpis.estimatedSalesWon)}
          detail={`${kpis.estimatedBookingCount} waiting for verification`}
          icon={<DollarSign size={20} />}
          tone={kpis.estimatedSalesWon > 0 ? 'amber' : 'gray'}
        />
        <KpiCard
          title="Verified Sales Won"
          value={formatCurrency(kpis.verifiedSalesWon)}
          detail={salesTarget > 0 ? `Against ${formatCurrency(salesTarget)} target` : monthLabel}
          icon={<BadgeCheck size={20} />}
          tone={kpis.verifiedSalesWon > 0 ? 'green' : 'gray'}
        />
        <KpiCard
          title="Total Sales Progress"
          value={formatCurrency(kpis.totalSalesProgress)}
          detail={salesTarget > 0 ? `${formatCurrency(kpis.totalSalesProgress)} / ${formatCurrency(salesTarget)}` : monthLabel}
          icon={<TrendingUp size={20} />}
          tone={getSalesProgressTone(kpis.totalSalesProgress, salesTarget)}
        />
        <KpiCard
          title="Site Visits Done"
          value={String(kpis.siteVisitsDone)}
          detail={countDetail(kpis.siteVisitsDone, siteVisitTarget)}
          icon={<ClipboardCheck size={20} />}
          tone={getCountTone(kpis.siteVisitsDone, siteVisitTarget)}
        />
        <KpiCard
          title="Quotes Sent"
          value={String(kpis.quotesSent)}
          detail={countDetail(kpis.quotesSent, quoteTarget)}
          icon={<Send size={20} />}
          tone={getCountTone(kpis.quotesSent, quoteTarget)}
        />
        <KpiCard
          title="Bookings Won"
          value={String(kpis.bookingsWon)}
          detail={countDetail(kpis.bookingsWon, bookingTarget)}
          icon={<CalendarCheck size={20} />}
          tone={getCountTone(kpis.bookingsWon, bookingTarget)}
        />
        <KpiCard
          title="Training Sessions"
          value={String(kpis.trainingSessions)}
          detail={countDetail(kpis.trainingSessions, trainingTarget)}
          icon={<GraduationCap size={20} />}
          tone={getCountTone(kpis.trainingSessions, trainingTarget)}
        />
        <KpiCard
          title="Consultancy Meetings"
          value={String(kpis.consultancyMeetings)}
          detail={countDetail(kpis.consultancyMeetings, consultancyTarget)}
          icon={<Handshake size={20} />}
          tone={getCountTone(kpis.consultancyMeetings, consultancyTarget)}
        />
      </section>
      {needsReview ? (
        <div className="kpi-alert-strip">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            {formatCurrency(kpis.mismatchSales)} mismatch and {formatCurrency(kpis.notFoundSales)} not found require review.
          </span>
        </div>
      ) : null}
    </div>
  )
}
