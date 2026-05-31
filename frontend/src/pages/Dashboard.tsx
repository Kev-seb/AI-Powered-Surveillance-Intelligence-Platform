import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Activity, Users, Video,
  TrendingUp, Eye, Zap, Clock,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { analyticsApi, alertsApi } from '@/api/client'
import { useAlertStore } from '@/store/alertStore'
import { format } from 'date-fns'

const SEVERITY_COLORS = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#dc2626',
}

function MetricCard({ icon: Icon, label, value, color, sub }: {
  icon: React.ElementType, label: string, value: string | number, color: string, sub?: string
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="glass-card metric-card p-5"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#475569' }}>
            {label}
          </p>
          <p className="text-3xl font-bold" style={{ color }}>
            {value}
          </p>
          {sub && <p className="text-xs mt-1" style={{ color: '#475569' }}>{sub}</p>}
        </div>
        <div className="p-3 rounded-xl" style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
      </div>
    </motion.div>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`badge badge-${severity}`}>{severity}</span>
  )
}

export default function Dashboard() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: analyticsApi.dashboard,
    refetchInterval: 15_000,
  })

  const { data: historicAlerts = [] } = useQuery({
    queryKey: ['historic-alerts'],
    queryFn: () => alertsApi.list({ limit: 20 }),
    refetchInterval: 30_000,
  })

  const { alerts } = useAlertStore()

  // Merge dynamic WebSocket alerts with historical database alerts (deduplicating by ID)
  const mergedAlerts = [
    ...alerts,
    ...historicAlerts.map((h: any) => ({
      id: h.id,
      type: h.alert_type,
      severity: h.severity,
      title: h.title,
      description: h.description,
      threat_score: h.threat_score,
      timestamp: h.created_at,
    }))
  ].filter((alert, index, self) =>
    self.findIndex(a => a.id === alert.id) === index
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner" />
      </div>
    )
  }

  const hourlyData = (metrics?.hourly_events || []).map((h: any) => ({
    time: format(new Date(h.hour), 'HH:mm'),
    events: h.count,
    threat: h.avg_threat * 100,
  }))

  const severityData = Object.entries(metrics?.severity_breakdown || {}).map(([k, v]) => ({
    name: k,
    value: v as number,
    color: SEVERITY_COLORS[k as keyof typeof SEVERITY_COLORS] || '#64748b',
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>
            Operations Center
          </h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Real-time surveillance intelligence dashboard
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <span className="status-dot status-live" />
          <span className="text-sm font-medium" style={{ color: '#10b981' }}>LIVE</span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={AlertTriangle} label="Events Today"
          value={metrics?.total_events_today ?? 0} color="#00d4ff"
        />
        <MetricCard
          icon={Zap} label="Active Threats"
          value={metrics?.active_threats ?? 0} color="#ef4444"
          sub="unacknowledged"
        />
        <MetricCard
          icon={Users} label="Persons Detected"
          value={metrics?.persons_detected ?? 0} color="#7c3aed"
          sub="unique tracks"
        />
        <MetricCard
          icon={Video} label="Videos Processed"
          value={metrics?.videos_processed ?? 0} color="#10b981"
          sub="today"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Hourly Events Chart */}
        <div className="glass-card p-5 col-span-2">
          <h2 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>
            Event Activity — Last 24 Hours
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="eventGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="threatGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#0d1224', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Area type="monotone" dataKey="events" stroke="#00d4ff" fill="url(#eventGrad)" strokeWidth={2} name="Events" />
              <Area type="monotone" dataKey="threat" stroke="#ef4444" fill="url(#threatGrad)" strokeWidth={1.5} name="Avg Threat %" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Severity Distribution */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>
            Severity Distribution
          </h2>
          {severityData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={severityData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" strokeWidth={0}>
                    {severityData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0d1224', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {severityData.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                      <span className="capitalize" style={{ color: '#94a3b8' }}>{s.name}</span>
                    </div>
                    <span style={{ color: s.color }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-xs" style={{ color: '#475569' }}>
              No events today
            </div>
          )}
        </div>
      </div>

      {/* Live Alerts + Top Zones */}
      <div className="grid grid-cols-3 gap-4">
        {/* Live Alert Feed */}
        <div className="glass-card p-5 col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4" style={{ color: '#00d4ff' }} />
            <h2 className="text-sm font-semibold" style={{ color: '#94a3b8' }}>Live Alert Feed</h2>
            {mergedAlerts.length > 0 && (
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(0,212,255,0.1)', color: '#00d4ff' }}>
                {mergedAlerts.length} total
              </span>
            )}
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {mergedAlerts.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: '#334155' }}>
                <Eye className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Monitoring for events...</p>
              </div>
            ) : (
              mergedAlerts.slice(0, 10).map((alert, i) => (

                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 p-3 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <span className={`status-dot mt-1.5 ${
                    alert.severity === 'critical' ? 'status-alert' :
                    alert.severity === 'high' ? 'status-warn' : 'status-live'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>
                        {alert.title}
                      </p>
                      <SeverityBadge severity={alert.severity} />
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: '#475569' }}>
                      {alert.description}
                    </p>
                  </div>
                  <span className="text-xs flex-shrink-0" style={{ color: '#334155' }}>
                    {format(new Date(alert.timestamp), 'HH:mm')}
                  </span>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Top Zones */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>
            Top Activity Zones
          </h2>
          <div className="space-y-3">
            {(metrics?.top_zones || []).map((z: any, i: number) => (
              <div key={z.zone}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: '#94a3b8' }}>{z.zone}</span>
                  <span style={{ color: '#00d4ff' }}>{z.count}</span>
                </div>
                <div className="threat-meter">
                  <div
                    className="threat-fill"
                    style={{
                      width: `${Math.min(100, (z.count / ((metrics?.top_zones[0]?.count || 1))) * 100)}%`,
                      background: i === 0 ? '#ef4444' : i === 1 ? '#f59e0b' : '#00d4ff',
                    }}
                  />
                </div>
              </div>
            ))}
            {(!metrics?.top_zones || metrics.top_zones.length === 0) && (
              <p className="text-xs text-center py-4" style={{ color: '#334155' }}>No zone data</p>
            )}
          </div>

          {/* Avg Threat Score */}
          <div className="mt-6 p-3 rounded-lg" style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.1)' }}>
            <p className="text-xs" style={{ color: '#475569' }}>Avg Threat Score</p>
            <p className="text-2xl font-bold mt-1" style={{ color: '#00d4ff' }}>
              {((metrics?.avg_threat_score || 0) * 100).toFixed(1)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
