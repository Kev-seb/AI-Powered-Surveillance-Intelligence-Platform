import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  FileText, Download, Table2, Clock,
  Filter, BarChart3, AlertTriangle, Archive,
} from 'lucide-react'
import { reportsApi, eventsApi, auditApi } from '@/api/client'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

function ReportCard({ icon: Icon, title, description, color, action, actionLabel, loading }: {
  icon: React.ElementType, title: string, description: string,
  color: string, action: () => void, actionLabel: string, loading?: boolean
}) {
  return (
    <motion.div whileHover={{ scale: 1.02 }} className="glass-card p-6">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl flex-shrink-0"
          style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
          <Icon className="w-6 h-6" style={{ color }} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold" style={{ color: '#e2e8f0' }}>{title}</h3>
          <p className="text-sm mt-1" style={{ color: '#64748b' }}>{description}</p>
          <button
            onClick={action}
            disabled={loading}
            className="btn-glow mt-4 py-1.5 text-xs"
            style={{ borderColor: `${color}40`, color }}
          >
            {loading ? 'Generating...' : actionLabel}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

export default function Reports() {
  const [exportLoading, setExportLoading] = useState(false)
  const [auditExportLoading, setAuditExportLoading] = useState(false)
  const [severityFilter, setSeverityFilter] = useState('all')

  const { data: recentEvents = [], isLoading } = useQuery({
    queryKey: ['events-for-reports', severityFilter],
    queryFn: () => eventsApi.list({
      severity: severityFilter === 'all' ? undefined : severityFilter,
      per_page: 20,
    }).then((d) => d.items),
  })

  const handleExportCsv = async () => {
    setExportLoading(true)
    try {
      const resp = await reportsApi.exportCsv({
        severity: severityFilter === 'all' ? undefined : severityFilter,
      })
      const url = window.URL.createObjectURL(new Blob([resp.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `events_export_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('CSV exported successfully')
    } catch {
      toast.error('Export failed')
    } finally {
      setExportLoading(false)
    }
  }

  const handleExportAuditCsv = async () => {
    setAuditExportLoading(true)
    try {
      const resp = await auditApi.exportCsv()
      const url = window.URL.createObjectURL(new Blob([resp.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `audit_log_export_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('Audit log exported successfully')
    } catch {
      toast.error('Audit export failed')
    } finally {
      setAuditExportLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Reports & Exports</h1>
        <p className="text-sm mt-1" style={{ color: '#475569' }}>Generate and download security reports</p>
      </div>

      {/* Report Options */}
      <div className="grid grid-cols-2 gap-4">
        <ReportCard
          icon={FileText}
          title="Incident DOCX Report"
          description="Select an incident from the Incident Center and click 'AI Report' to generate a structured Word document with AI-narrated summary."
          color="#7c3aed"
          action={() => window.location.href = '/incidents'}
          actionLabel="→ Go to Incident Center"
        />
        <ReportCard
          icon={Table2}
          title="Events CSV Export"
          description="Export all detection events as a CSV file for further analysis in Excel or data tools."
          color="#00d4ff"
          action={handleExportCsv}
          actionLabel="Download CSV"
          loading={exportLoading}
        />
        <ReportCard
          icon={BarChart3}
          title="Daily Intelligence Briefing"
          description="AI-generated daily summary of surveillance activity, threat patterns, and operational recommendations."
          color="#10b981"
          action={() => toast('Daily briefing is generated automatically every 24 hours', { icon: '📋' })}
          actionLabel="View Latest Briefing"
        />
        <ReportCard
          icon={Archive}
          title="Audit Log Export"
          description="Export the full audit trail of system access, actions, and API calls for compliance review."
          color="#f59e0b"
          action={handleExportAuditCsv}
          actionLabel="Export Audit Log"
          loading={auditExportLoading}
        />
      </div>

      {/* Event Table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: '#f59e0b' }} />
            <span className="text-sm font-medium" style={{ color: '#94a3b8' }}>Recent Events</span>
          </div>
          <div className="flex items-center gap-3">
            <Filter className="w-3.5 h-3.5" style={{ color: '#475569' }} />
            <select className="asip-input text-xs py-1 w-auto" value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.06)' }}>
                {['Timestamp', 'Type', 'Severity', 'Threat', 'Zone', 'Track ID', 'Behaviors', 'Status'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium uppercase tracking-wider"
                    style={{ color: '#475569' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    <div className="spinner mx-auto" />
                  </td>
                </tr>
              ) : recentEvents.map((ev: any, i: number) => (
                <motion.tr
                  key={ev.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  style={{ borderBottom: '1px solid rgba(0,212,255,0.04)' }}
                  className="hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3 font-mono" style={{ color: '#475569' }}>
                    {format(new Date(ev.timestamp), 'MM/dd HH:mm:ss')}
                  </td>
                  <td className="px-4 py-3" style={{ color: '#94a3b8' }}>
                    {ev.event_type.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge badge-${ev.severity}`}>{ev.severity}</span>
                  </td>
                  <td className="px-4 py-3"
                    style={{ color: ev.threat_score > 0.7 ? '#ef4444' : ev.threat_score > 0.4 ? '#f59e0b' : '#10b981' }}>
                    {(ev.threat_score * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-3" style={{ color: '#64748b' }}>{ev.zone_name || '—'}</td>
                  <td className="px-4 py-3 font-mono" style={{ color: '#64748b' }}>#{ev.track_id || '—'}</td>
                  <td className="px-4 py-3" style={{ color: '#f59e0b' }}>
                    {ev.behavior_flags?.join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {ev.acknowledged ? (
                      <span style={{ color: '#10b981' }}>✓ Acked</span>
                    ) : (
                      <span style={{ color: '#475569' }}>Pending</span>
                    )}
                  </td>
                </motion.tr>
              ))}
              {!isLoading && recentEvents.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-xs" style={{ color: '#334155' }}>
                    No events found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
