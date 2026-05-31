import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  ClipboardList, Search, Filter, RefreshCw,
  User, Clock, Tag, Shield,
} from 'lucide-react'
import { api } from '@/api/client'
import { format } from 'date-fns'

const auditApi = {
  list: (params?: any) => api.get('/audit/', { params }).then(r => r.data),
  summary: () => api.get('/audit/summary').then(r => r.data),
}

const ACTION_COLORS: Record<string, string> = {
  GET: '#10b981',
  POST: '#00d4ff',
  PUT: '#f59e0b',
  DELETE: '#ef4444',
  PATCH: '#7c3aed',
}

function getMethodColor(action: string) {
  for (const [method, color] of Object.entries(ACTION_COLORS)) {
    if (action?.toUpperCase().includes(method)) return color
  }
  return '#64748b'
}

function StatusDot({ code }: { code?: number }) {
  const color = !code ? '#64748b' : code < 300 ? '#10b981' : code < 400 ? '#f59e0b' : '#ef4444'
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
      {code || '—'}
    </span>
  )
}

export default function AuditLog() {
  const [search, setSearch] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', search, resourceFilter, page],
    queryFn: () => auditApi.list({
      username: search || undefined,
      resource_type: resourceFilter || undefined,
      page,
      per_page: 50,
    }),
    placeholderData: (prev) => prev,
  })

  const { data: summary } = useQuery({
    queryKey: ['audit-summary'],
    queryFn: auditApi.summary,
    refetchInterval: 60000,
  })

  const logs = data?.items || []
  const total = data?.total || 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Audit Log</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Complete platform activity trail — {total.toLocaleString()} records
          </p>
        </div>
        <button onClick={() => refetch()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <div className="glass-card p-4">
            <p className="text-xs" style={{ color: '#475569' }}>Events (24h)</p>
            <p className="text-2xl font-bold mt-1" style={{ color: '#00d4ff' }}>
              {(summary.total_24h || 0).toLocaleString()}
            </p>
          </div>
          {(summary.top_actions || []).slice(0, 3).map((a: any) => (
            <div key={a.action} className="glass-card p-4">
              <p className="text-xs font-mono truncate" style={{ color: '#475569' }}>{a.action}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: '#94a3b8' }}>{a.count}</p>
              <p className="text-xs mt-0.5" style={{ color: '#334155' }}>{a.unique_users} users</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="glass-card p-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#475569' }} />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="asip-input pl-9 text-sm"
            placeholder="Filter by username…"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#475569' }} />
          <input
            value={resourceFilter}
            onChange={(e) => { setResourceFilter(e.target.value); setPage(1) }}
            className="asip-input pl-9 text-sm w-48"
            placeholder="Resource type…"
          />
        </div>
      </div>

      {/* Log table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,212,255,0.08)' }}>
                {['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'Status', 'Duration', 'IP'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium" style={{ color: '#475569' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="py-12 text-center"><div className="spinner mx-auto" /></td></tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center" style={{ color: '#334155' }}>
                    No audit logs found
                  </td>
                </tr>
              ) : (
                logs.map((log: any, i: number) => (
                  <motion.tr
                    key={log.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.01 }}
                    className="border-b hover:bg-white/[0.01] transition-colors"
                    style={{ borderColor: 'rgba(255,255,255,0.03)' }}
                  >
                    <td className="px-4 py-2.5 font-mono" style={{ color: '#64748b' }}>
                      {format(new Date(log.timestamp), 'MMM dd HH:mm:ss')}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3" style={{ color: '#475569' }} />
                        <span style={{ color: '#94a3b8' }}>{log.username || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono">
                      <span style={{ color: getMethodColor(log.action) }}>{log.action}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Tag className="w-3 h-3" style={{ color: '#334155' }} />
                        <span style={{ color: '#64748b' }}>{log.resource_type || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: '#475569' }}>
                      {log.resource_id ? log.resource_id.slice(0, 8) + '…' : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusDot code={log.status_code} />
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: '#475569' }}>
                      {log.duration_ms != null ? `${log.duration_ms}ms` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: '#334155' }}>
                      {log.ip_address || '—'}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 50 && (
          <div className="px-4 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
            <span className="text-xs" style={{ color: '#475569' }}>
              Page {page} of {Math.ceil(total / 50)} • {total} records
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 text-xs rounded disabled:opacity-40"
                style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff' }}
              >Previous</button>
              <button
                disabled={page >= Math.ceil(total / 50)}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 text-xs rounded disabled:opacity-40"
                style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff' }}
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
