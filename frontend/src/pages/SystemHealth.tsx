import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Database, Server, Cpu, Activity, CheckCircle2,
  XCircle, AlertTriangle, RefreshCw, Wifi, Clock,
  HardDrive, Zap, Box,
} from 'lucide-react'
import { api } from '@/api/client'
import { format } from 'date-fns'

const systemHealthApi = {
  full: () => api.get('/system/system').then(r => r.data),
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'healthy') return <CheckCircle2 className="w-4 h-4" style={{ color: '#10b981' }} />
  if (status === 'warning') return <AlertTriangle className="w-4 h-4" style={{ color: '#f59e0b' }} />
  return <XCircle className="w-4 h-4" style={{ color: '#ef4444' }} />
}

function LatencyBar({ ms }: { ms: number }) {
  const max = 500
  const pct = Math.min(100, Math.max(0, (ms / max) * 100))
  const color = ms < 50 ? '#10b981' : ms < 200 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded overflow-hidden" style={{ height: 4, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
      <span className="text-xs font-mono w-14 text-right" style={{ color }}>{ms}ms</span>
    </div>
  )
}

function ServiceCard({ name, data, icon: Icon, extraFields }: {
  name: string, data: any, icon: any, extraFields?: { label: string, key: string, format?: (v: any) => string }[]
}) {
  const status = data?.status || 'unknown'
  const statusColors = { healthy: '#10b981', warning: '#f59e0b', error: '#ef4444', unknown: '#64748b' }
  const color = statusColors[status as keyof typeof statusColors] || '#64748b'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5"
      style={{ borderColor: `${color}30` }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>{name}</p>
            <p className="text-xs capitalize" style={{ color }}>{status}</p>
          </div>
        </div>
        <StatusIcon status={status} />
      </div>

      {data?.latency_ms !== undefined && data.latency_ms >= 0 && (
        <div className="mb-3">
          <p className="text-xs mb-1" style={{ color: '#475569' }}>Latency</p>
          <LatencyBar ms={data.latency_ms} />
        </div>
      )}

      {extraFields && (
        <div className="space-y-1.5">
          {extraFields.map(({ label, key, format: fmt }) => {
            const val = data?.[key]
            if (val === undefined || val === null) return null
            return (
              <div key={key} className="flex justify-between text-xs">
                <span style={{ color: '#475569' }}>{label}</span>
                <span className="font-mono" style={{ color: '#94a3b8' }}>
                  {fmt ? fmt(val) : String(val)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {data?.error && (
        <div className="mt-3 p-2 rounded text-xs" style={{ background: '#ef444415', color: '#ef4444' }}>
          {data.error}
        </div>
      )}
    </motion.div>
  )
}

function OverallStatus({ overall }: { overall: string }) {
  const config = {
    healthy: { color: '#10b981', label: 'All Systems Operational', icon: CheckCircle2 },
    degraded: { color: '#ef4444', label: 'System Degraded', icon: XCircle },
    warning: { color: '#f59e0b', label: 'System Warning', icon: AlertTriangle },
  }[overall] || { color: '#64748b', label: 'Unknown', icon: AlertTriangle }

  const Icon = config.icon

  return (
    <div className="glass-card p-6 flex items-center gap-4"
      style={{ borderColor: `${config.color}30` }}>
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: `${config.color}15`, border: `1px solid ${config.color}40` }}>
        <Icon className="w-7 h-7" style={{ color: config.color }} />
      </div>
      <div>
        <p className="text-xl font-bold" style={{ color: config.color }}>{config.label}</p>
        <p className="text-sm mt-0.5" style={{ color: '#475569' }}>
          Platform infrastructure status
        </p>
      </div>
      <div className="ml-auto text-right">
        <p className="text-xs" style={{ color: '#334155' }}>Last checked</p>
        <p className="text-sm font-mono" style={{ color: '#94a3b8' }}>
          {format(new Date(), 'HH:mm:ss')}
        </p>
      </div>
    </div>
  )
}

export default function SystemHealth() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['system-health'],
    queryFn: systemHealthApi.full,
    refetchInterval: 30000,
    staleTime: 10000,
  })

  const services = data?.services || {}

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>System Health</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Real-time infrastructure diagnostics and service status
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="spinner" />
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <div className="space-y-5">
            {/* Overall status */}
            <OverallStatus overall={data?.overall || 'unknown'} />

            {/* Service grid */}
            <div className="grid grid-cols-3 gap-4">
              <ServiceCard
                name="PostgreSQL / TimescaleDB"
                data={services.postgresql}
                icon={Database}
                extraFields={[
                  { label: 'Version', key: 'version' },
                  { label: 'DB Size', key: 'db_size_mb', format: v => `${v} MB` },
                ]}
              />
              <ServiceCard
                name="Redis Cache"
                data={services.redis}
                icon={Zap}
                extraFields={[
                  { label: 'Version', key: 'version' },
                  { label: 'Clients', key: 'connected_clients' },
                  { label: 'Memory', key: 'used_memory_mb', format: v => `${v} MB` },
                ]}
              />
              <ServiceCard
                name="MongoDB"
                data={services.mongodb}
                icon={HardDrive}
                extraFields={[
                  { label: 'Version', key: 'version' },
                  { label: 'Connections', key: 'connections' },
                ]}
              />
              <ServiceCard
                name="Celery Workers"
                data={services.celery}
                icon={Cpu}
                extraFields={[
                  { label: 'Workers', key: 'workers' },
                  { label: 'Active Tasks', key: 'active_tasks' },
                  { label: 'Message', key: 'message' },
                ]}
              />
              <ServiceCard
                name="Ollama LLM"
                data={services.ollama}
                icon={Box}
                extraFields={[
                  { label: 'Models', key: 'model_count' },
                  {
                    label: 'Loaded',
                    key: 'models',
                    format: (v: string[]) => v.length > 0 ? v[0].split(':')[0] : '—',
                  },
                ]}
              />
              <div className="glass-card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}>
                    <Activity className="w-5 h-5" style={{ color: '#00d4ff' }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>API Gateway</p>
                    <p className="text-xs" style={{ color: '#10b981' }}>healthy</p>
                  </div>
                  <CheckCircle2 className="ml-auto w-4 h-4" style={{ color: '#10b981' }} />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span style={{ color: '#475569' }}>Framework</span>
                    <span className="font-mono" style={{ color: '#94a3b8' }}>FastAPI</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: '#475569' }}>Auth</span>
                    <span className="font-mono" style={{ color: '#94a3b8' }}>JWT / Bearer</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: '#475569' }}>Transport</span>
                    <span className="font-mono" style={{ color: '#94a3b8' }}>HTTP + WebSocket</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Service latency chart */}
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>Service Latency Overview</h3>
              <div className="space-y-3">
                {Object.entries(services).map(([key, svc]: [string, any]) => (
                  svc?.latency_ms != null && svc.latency_ms >= 0 && (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span style={{ color: '#94a3b8' }} className="capitalize">{key}</span>
                      </div>
                      <LatencyBar ms={svc.latency_ms} />
                    </div>
                  )
                ))}
              </div>
            </div>
          </div>
        </AnimatePresence>
      )}
    </div>
  )
}
