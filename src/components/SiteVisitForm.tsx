import { CalendarPlus } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { NewSiteVisitInput } from '../types/performance'
import type { SiteVisitPrefillOutcome, SiteVisitPrefillRequest } from '../types/siteVisitAnalyzer'
import { mergeSiteVisitAnalysisIntoForm } from '../utils/siteVisitPrefill'

type SiteVisitFormProps = {
  onSubmit: (input: NewSiteVisitInput) => void
  prefillRequest?: SiteVisitPrefillRequest | null
  onPrefillApplied?: (outcome: SiteVisitPrefillOutcome) => void
}

type SiteVisitFormState = Omit<NewSiteVisitInput, 'estimated_quote_value'> & {
  estimated_quote_value: string
}

const initialState = (): SiteVisitFormState => ({
  customer_full_name: '',
  contact_person: '',
  contact_number: '',
  email: '',
  job_id: '',
  address: '',
  suburb: '',
  booked_date: '',
  booked_time: '',
  move_type: 'Residential move',
  notes: '',
  estimated_quote_value: '',
})

export function SiteVisitForm({ onSubmit, prefillRequest = null, onPrefillApplied }: SiteVisitFormProps) {
  const [form, setForm] = useState<SiteVisitFormState>(initialState)
  const [prefillOutcome, setPrefillOutcome] = useState<SiteVisitPrefillOutcome | null>(null)
  const lastPrefillIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!prefillRequest || prefillRequest.id === lastPrefillIdRef.current) {
      return
    }

    lastPrefillIdRef.current = prefillRequest.id
    const result = mergeSiteVisitAnalysisIntoForm(form, prefillRequest.analysis)
    setForm(result.form)
    setPrefillOutcome(result.outcome)
  }, [form, prefillRequest])

  useEffect(() => {
    if (prefillOutcome) {
      onPrefillApplied?.(prefillOutcome)
    }
  }, [onPrefillApplied, prefillOutcome])

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const estimatedValue = form.estimated_quote_value ? Number(form.estimated_quote_value) : null

    onSubmit({
      ...form,
      estimated_quote_value: Number.isFinite(estimatedValue) ? estimatedValue : null,
    })
    setForm(initialState())
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <label>
        Customer name
        <input
          required
          name="customer_full_name"
          value={form.customer_full_name}
          onChange={handleChange}
          placeholder="Customer full name"
        />
      </label>
      <label>
        Contact number
        <input
          required
          name="contact_number"
          value={form.contact_number}
          onChange={handleChange}
          placeholder="Mobile or landline"
        />
      </label>
      <label>
        Contact person
        <input name="contact_person" value={form.contact_person} onChange={handleChange} placeholder="Optional" />
      </label>
      <label>
        Email
        <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="Optional" />
      </label>
      <label>
        Job ID
        <input name="job_id" value={form.job_id} onChange={handleChange} placeholder="Optional reference" />
      </label>
      <label className="span-2">
        Address
        <input name="address" value={form.address} onChange={handleChange} placeholder="Street address" />
      </label>
      <label>
        Suburb
        <input required name="suburb" value={form.suburb} onChange={handleChange} placeholder="Suburb" />
      </label>
      <label>
        Move type
        <select name="move_type" value={form.move_type} onChange={handleChange}>
          <option>Residential move</option>
          <option>Office move</option>
          <option>Storage</option>
          <option>Packing</option>
          <option>Consultancy</option>
        </select>
      </label>
      <label>
        Date
        <input required name="booked_date" type="date" value={form.booked_date} onChange={handleChange} />
      </label>
      <label>
        Time
        <input required name="booked_time" type="time" value={form.booked_time} onChange={handleChange} />
      </label>
      <label>
        Estimated quote value
        <input
          name="estimated_quote_value"
          type="number"
          min="0"
          step="0.01"
          value={form.estimated_quote_value}
          onChange={handleChange}
          placeholder="Optional"
        />
      </label>
      <label className="span-2">
        Notes
        <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} placeholder="Optional" />
      </label>
      <button className="primary-button span-2" type="submit">
        <CalendarPlus size={18} aria-hidden="true" />
        Add Site Visit
      </button>
    </form>
  )
}
