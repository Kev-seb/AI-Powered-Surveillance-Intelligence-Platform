import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, ChevronUp, CheckCircle2,
  FileText, Brain, AlertTriangle, Filter,
} from 'lucide-react'
import { eventsApi, reportsApi } from '@/api/client'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

type Severity = 'all' | 'low' | 'medium' | 'high' | 'critical'

function IncidentCard({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false)
  const [report, setReport] = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const qc = useQueryClient()

  const ackMutation = useMutation({
    mutationFn: () => eventsApi.acknowledge(event.id),
    onSuccess: () => {
      toast.success('Event acknowledged')
      qc.invalidateQueries({ queryKey: ['events'] })
    },
  })

  const generateReport = async () => {
    setLoadingReport(true)
    setExpanded(true)
    try {
      const r = await reportsApi.generateIncident(event.id)
      setReport(r)
    } catch {
      toast.error('Failed to generate report')
    } finally {
      setLoadingReport(false)
    }
  }

  useEffect(() => {
    if (expanded && !report && !loadingReport) {
      generateReport()
    }
  }, [expanded])

  const downloadDocx = async () => {
    if (!report?.id) return
    try {
      const resp = await reportsApi.downloadDocx(report.id)
      const url = window.URL.createObjectURL(new Blob([resp.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `incident_${event.id.slice(0,8)}.docx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch { toast.error('Download failed') }
  }

  return (
    <motion.div
      layout
      className="glass-card overflow-hidden"
      style={{
        borderColor: event.severity === 'critical' ? 'rgba(220,38,38,0.3)' :
                     event.severity === 'high'     ? 'rgba(239,68,68,0.2)' :
                     'rgba(0,212,255,0.08)',
      }}
    >
      <div
        className="flex items-center gap-4 p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Severity indicator */}
        <div className="w-1 self-stretch rounded-full flex-shrink-0"
          style={{ background:
            event.severity === 'critical' ? '#dc2626' :
            event.severity === 'high'     ? '#ef4444' :
            event.severity === 'medium'   ? '#f59e0b' : '#10b981'
          }} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: '#e2e8f0' }}>
              {event.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
            </span>
            <span className={`badge badge-${event.severity}`}>{event.severity}</span>
            {event.acknowledged && (
              <span className="badge" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                ✓ Acknowledged
              </span>
            )}
          </div>
          <div className="flex gap-4 mt-1 text-xs" style={{ color: '#475569' }}>
            <span>{format(new Date(event.timestamp), 'MMM dd, HH:mm:ss')}</span>
            {event.zone_name && <span>{event.zone_name}</span>}
            <span>Threat: {(event.threat_score * 100).toFixed(0)}%</span>
            {event.behavior_flags?.length > 0 && (
              <span style={{ color: '#f59e0b' }}>{event.behavior_flags.join(', ')}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!event.acknowledged && (
            <button
              onClick={(e) => { e.stopPropagation(); ackMutation.mutate() }}
              className="btn-glow py-1 px-2 text-xs"
              disabled={ackMutation.isPending}
            >
              <CheckCircle2 className="w-3 h-3 inline mr-1" />Ack
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); generateReport() }}
            className="btn-glow py-1 px-2 text-xs"
            disabled={loadingReport}
            style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#a78bfa' }}
          >
            <Brain className="w-3 h-3 inline mr-1" />
            {loadingReport ? 'Generating...' : 'AI Report'}
          </button>
          {expanded ? <ChevronUp className="w-4 h-4" style={{ color: '#475569' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#475569' }} />}
        </div>
      </div>

      {/* Expanded GenAI Summary */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t" style={{ borderColor: 'rgba(0,212,255,0.06)' }}>
              {loadingReport ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-3">
                  <div className="spinner" />
                  <p className="text-xs animate-pulse" style={{ color: '#a78bfa' }}>AI is analyzing the incident and generating report...</p>
                </div>
              ) : report ? (
                <div className="pt-4 space-y-4">
                  {/* AI Badge */}
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4" style={{ color: '#a78bfa' }} />
                    <span className="text-xs font-medium" style={{ color: '#a78bfa' }}>
                      AI Incident Analysis — {report.llm_provider?.toUpperCase()} / {report.llm_model}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-1" style={{ color: '#e2e8f0' }}>
                      {report.title}
                    </h3>
                    <p className="text-sm leading-relaxed" style={{ color: '#94a3b8' }}>
                      {report.summary}
                    </p>
                  </div>

                  {report.recommended_actions?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>
                        RECOMMENDED ACTIONS
                      </p>
                      <ul className="space-y-1">
                        {report.recommended_actions.map((action: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-xs"
                            style={{ color: '#94a3b8' }}>
                            <span className="text-cyan-500 flex-shrink-0">{i + 1}.</span>
                            {action}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {report.confidence_notes && (
                    <p className="text-xs italic" style={{ color: '#475569' }}>
                      {report.confidence_notes}
                    </p>
                  )}

                  <button onClick={downloadDocx} className="btn-glow text-xs py-1.5">
                    <FileText className="w-3.5 h-3.5 inline mr-1" /> Download DOCX
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 space-y-2">
                  <p className="text-sm" style={{ color: '#64748b' }}>No AI analysis report available.</p>
                  <button onClick={generateReport} className="btn-glow text-xs py-1 px-3">
                    Generate Report
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function IncidentCenter() {
  const [severityFilter, setSeverityFilter] = useState<Severity>('all')
  const [showUnacknowledged, setShowUnacknowledged] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['events', severityFilter, showUnacknowledged, page],
    queryFn: () => eventsApi.list({
      severity: severityFilter === 'all' ? undefined : severityFilter,
      acknowledged: showUnacknowledged ? false : undefined,
      page,
      per_page: 20,
    }),
  })

  const events = data?.items || []
  const total = data?.total || 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Incident Center</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            {total} total incidents
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4" style={{ color: '#475569' }} />
          <select
            className="asip-input w-auto py-1.5 text-xs"
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value as Severity); setPage(1) }}
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: '#94a3b8' }}>
            <input
              type="checkbox"
              checked={showUnacknowledged}
              onChange={(e) => setShowUnacknowledged(e.target.checked)}
              className="rounded"
            />
            Unacknowledged only
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="spinner" /></div>
      ) : events.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#f59e0b' }} />
          <p style={{ color: '#334155' }}>No incidents found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event: any) => (
            <IncidentCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex justify-center gap-3 pt-2">
          <button className="btn-glow py-1.5 px-4 text-xs" disabled={page === 1}
            onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className="py-1.5 px-3 text-xs" style={{ color: '#475569' }}>
            Page {page} of {Math.ceil(total / 20)}
          </span>
          <button className="btn-glow py-1.5 px-4 text-xs" disabled={page * 20 >= total}
            onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
