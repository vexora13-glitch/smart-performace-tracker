type StatusPillProps = {
  status: string
}

const statusClassMap: Record<string, string> = {
  Booked: 'blue',
  Completed: 'green',
  'Report Sent': 'teal',
  'Quote Sent': 'indigo',
  Won: 'green',
  'Lost / Closed': 'red',
  Draft: 'gray',
  Sent: 'indigo',
  'Follow Up': 'amber',
  Lost: 'red',
  Estimated: 'amber',
  Verified: 'green',
  Mismatch: 'red',
  'Not Found': 'red',
  'External Only': 'red',
  Cancelled: 'red',
  'To Do': 'gray',
  'In Progress': 'blue',
}

export function StatusPill({ status }: StatusPillProps) {
  const tone = statusClassMap[status] ?? 'gray'
  return <span className={`status-pill status-pill--${tone}`}>{status}</span>
}
