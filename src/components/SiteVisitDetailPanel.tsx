import { Mail, Phone } from 'lucide-react'
import type { SiteVisit } from '../types/performance'
import { formatCurrency, formatDateTime } from '../utils/kpi'
import { StatusPill } from './StatusPill'

type SiteVisitDetailPanelProps = {
  siteVisit: SiteVisit
}

export function SiteVisitDetailPanel({ siteVisit }: SiteVisitDetailPanelProps) {
  return (
    <aside className="detail-panel" aria-label="Site visit details">
      <div className="detail-panel__header">
        <div>
          <span className="eyebrow">{siteVisit.reference_number}</span>
          <h2>{siteVisit.customer_full_name}</h2>
        </div>
        <StatusPill status={siteVisit.status} />
      </div>
      <dl className="detail-list">
        <div>
          <dt>Contact</dt>
          <dd>{siteVisit.contact_person ?? siteVisit.customer_full_name}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>
            <a className="inline-link" href={`tel:${siteVisit.contact_number}`}>
              <Phone size={15} aria-hidden="true" />
              {siteVisit.contact_number}
            </a>
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>
            {siteVisit.email ? (
              <a className="inline-link" href={`mailto:${siteVisit.email}`}>
                <Mail size={15} aria-hidden="true" />
                {siteVisit.email}
              </a>
            ) : (
              'Not set'
            )}
          </dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{siteVisit.address ? `${siteVisit.address}, ${siteVisit.suburb}` : siteVisit.suburb}</dd>
        </div>
        <div>
          <dt>Date/time</dt>
          <dd>{formatDateTime(siteVisit.booked_date, siteVisit.booked_time)}</dd>
        </div>
        <div>
          <dt>Move type</dt>
          <dd>{siteVisit.move_type ?? 'Not set'}</dd>
        </div>
        <div>
          <dt>Estimated quote</dt>
          <dd>{siteVisit.estimated_quote_value ? formatCurrency(siteVisit.estimated_quote_value) : 'Not set'}</dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd>{siteVisit.notes ?? 'No notes yet'}</dd>
        </div>
      </dl>
    </aside>
  )
}
