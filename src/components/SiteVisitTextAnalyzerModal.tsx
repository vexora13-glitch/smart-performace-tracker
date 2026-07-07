import { AlertTriangle, CheckCircle2, Loader2, Sparkles, X } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { analyzeSiteVisitText } from '../services/siteVisitTextAnalyzerService'
import type { SiteVisitPrefillOutcome, SiteVisitTextAnalysis } from '../types/siteVisitAnalyzer'

type SiteVisitTextAnalyzerModalProps = {
  isOpen: boolean
  prefillOutcome: SiteVisitPrefillOutcome | null
  onApply: (analysis: SiteVisitTextAnalysis) => void
  onClose: () => void
  onResetPrefillOutcome: () => void
}

type ExtractedField = {
  label: string
  value: string | number | null
}

const extractedFields = (analysis: SiteVisitTextAnalysis): ExtractedField[] => [
  { label: 'Customer name', value: analysis.customerName },
  { label: 'Phone', value: analysis.phone },
  { label: 'Email', value: analysis.email },
  { label: 'Address/location', value: analysis.address },
  { label: 'Preferred date', value: analysis.preferredDate },
  { label: 'Preferred time', value: analysis.preferredTime },
  { label: 'Job ID', value: analysis.jobId },
  { label: 'Confidence', value: `${Math.round(analysis.confidence * 100)}%` },
  { label: 'Notes', value: analysis.notes },
  { label: 'Summary', value: analysis.rawSummary },
]

export function SiteVisitTextAnalyzerModal({
  isOpen,
  prefillOutcome,
  onApply,
  onClose,
  onResetPrefillOutcome,
}: SiteVisitTextAnalyzerModalProps) {
  const [inputText, setInputText] = useState('')
  const [analysis, setAnalysis] = useState<SiteVisitTextAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  if (!isOpen) {
    return null
  }

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(event.target.value)
    setError(null)
    setAnalysis(null)
    onResetPrefillOutcome()
  }

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    setError(null)
    onResetPrefillOutcome()

    try {
      setAnalysis(await analyzeSiteVisitText(inputText))
    } catch (caughtError) {
      setAnalysis(null)
      setError(caughtError instanceof Error ? caughtError.message : 'Text analysis failed.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleApply = () => {
    if (analysis) {
      onApply(analysis)
    }
  }

  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-backdrop" type="button" aria-label="Close AI Text Analyzer" onClick={onClose} />
      <section className="modal-panel text-analyzer-modal" role="dialog" aria-modal="true" aria-labelledby="text-analyzer-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">AI prefill</span>
            <h2 id="text-analyzer-title">AI Text Analyzer</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close AI Text Analyzer" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="text-analyzer-body">
          <label className="text-analyzer-input">
            Inquiry text
            <textarea
              value={inputText}
              onChange={handleTextChange}
              rows={9}
              placeholder="Paste inquiry notes, email text, customer message, or booking instructions"
            />
          </label>

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="button" disabled={isAnalyzing || !inputText.trim()} onClick={handleAnalyze}>
              {isAnalyzing ? <Loader2 className="spin-icon" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
              Analyze Text
            </button>
          </div>

          {error ? (
            <div className="analyzer-message analyzer-message--error" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {analysis ? (
            <div className="analysis-result">
              <div className="analyzer-message analyzer-message--success">
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>Extracted details are ready. Blank form fields will be filled; existing values stay unchanged.</span>
              </div>

              <dl className="analysis-result-grid">
                {extractedFields(analysis).map((field) => (
                  <div key={field.label} className={field.value ? '' : 'is-empty'}>
                    <dt>{field.label}</dt>
                    <dd>{field.value || 'Not found'}</dd>
                  </div>
                ))}
              </dl>

              {prefillOutcome ? (
                <div className="analyzer-message analyzer-message--info">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <span>
                    Applied {prefillOutcome.appliedFields.length ? prefillOutcome.appliedFields.join(', ') : 'no new fields'}
                    {prefillOutcome.skippedFields.length ? `; kept existing ${prefillOutcome.skippedFields.join(', ')}` : ''}.
                  </span>
                </div>
              ) : null}

              <div className="modal-actions">
                <button className="primary-button" type="button" onClick={handleApply}>
                  <CheckCircle2 size={18} aria-hidden="true" />
                  Apply to Site Visit Form
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
