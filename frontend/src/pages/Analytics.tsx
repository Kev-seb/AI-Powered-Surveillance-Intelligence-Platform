import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  BarChart2, TrendingUp, Users, AlertTriangle,
  RefreshCw, ArrowUpRight,
  Crosshair, Map, Activity,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts'
import { analyticsApi, eventsApi } from '@/api/client'
import { format, subHours } from 'date-fns'

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#10b981',
  info: '#00d4ff',
}

function MetricCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string, value: any, sub?: string, icon: any, color: string, trend?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card p-5"
      style={{ borderColor: `${color}25` }}
    >
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        {trend !== undefined && (
          <div className="flex items-center gap-1 text-xs"
            style={{ color: trend >= 0 ? '#10b981' : '#ef4444' }}>
            <ArrowUpRight className="w-3 h-3" style={{ transform: trend < 0 ? 'rotate(90deg)' : undefined }} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-bold mt-3" style={{ color }}>{value}</p>
      <p className="text-xs mt-1 font-medium" style={{ color: '#94a3b8' }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: '#334155' }}>{sub}</p>}
    </motion.div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 rounded-lg text-xs shadow-xl"
      style={{ background: '#0d1224', border: '1px solid rgba(0,212,255,0.2)' }}>
      <p className="font-medium mb-1" style={{ color: '#94a3b8' }}>{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: '#64748b' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// Canvas-based heatmap
function HeatmapCanvas({ points }: { points: { x: number, y: number, weight: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || points.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    points.forEach(({ x, y, weight }) => {
      const cx = x * canvas.width
      const cy = y * canvas.height
      const r = 30
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      const alpha = Math.min(0.6, (weight || 0.1) * 0.6)
      grd.addColorStop(0, `rgba(239,68,68,${alpha})`)
      grd.addColorStop(0.5, `rgba(245,158,11,${alpha * 0.5})`)
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = grd
      ctx.fill()
    })
  }, [points])

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={338}
      style={{ width: '100%', height: '100%', borderRadius: 8, background: 'rgba(0,0,0,0.3)' }}
    />
  )
}

export default function Analytics() {
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h')
  const [selectedVideoId, setSelectedVideoId] = useState<string | undefined>()

  const { data: metrics, isLoading: metricsLoading, refetch } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: analyticsApi.dashboard,
    refetchInterval: 30000,
  })

  const { data: heatmap } = useQuery({
    queryKey: ['heatmap-all'],
    queryFn: () => analyticsApi.heatmap(),
    staleTime: 60000,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['analytics-events'],
    queryFn: () => eventsApi.list({ per_page: 200 }),
    select: d => d.items,
    refetchInterval: 30000,
  })

  // Build severity pie data
  const severityData = Object.entries(metrics?.severity_breakdown || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: value as number,
    color: SEVERITY_COLORS[name] || '#64748b',
  }))

  // Build hourly chart data
  const hourlyData = (metrics?.hourly_events || []).map((h: any) => ({
    hour: format(new Date(h.hour), 'HH:mm'),
    events: h.count,
    threat: Math.round(h.avg_threat * 100),
  }))

  // Event type bar data
  const typeData = Object.entries(metrics?.event_type_breakdown || {})
    .slice(0, 8)
    .map(([name, count]) => ({
      name: name.replace(/_/g, ' ').slice(0, 16),
      count: count as number,
    }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Analytics</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Platform-wide threat intelligence and behavioral analytics
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.15)' }}>
            {(['24h', '7d', '30d'] as const).map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className="px-3 py-1.5 text-xs"
                style={{
                  background: timeRange === r ? 'rgba(0,212,255,0.15)' : 'transparent',
                  color: timeRange === r ? '#00d4ff' : '#475569',
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <button onClick={() => refetch()} className="p-2 rounded-lg"
            style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          label="Events Today"
          value={(metrics?.total_events_today || 0).toLocaleString()}
          icon={Activity}
          color="#00d4ff"
        />
        <MetricCard
          label="Active Threats"
          value={metrics?.active_threats || 0}
          icon={AlertTriangle}
          color="#ef4444"
          sub="Unacknowledged critical/high"
        />
        <MetricCard
          label="Persons Detected"
          value={metrics?.persons_detected || 0}
          icon={Users}
          color="#7c3aed"
          sub="Unique track IDs today"
        />
        <MetricCard
          label="Avg Threat Score"
          value={`${(metrics?.avg_threat_score * 100 || 0).toFixed(0)}%`}
          icon={TrendingUp}
          color={metrics?.avg_threat_score > 0.6 ? '#ef4444' : '#10b981'}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-3 gap-5">
        {/* Hourly events area chart */}
        <div className="col-span-2 glass-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>
            <Activity className="w-4 h-4 inline mr-2" style={{ color: '#00d4ff' }} />
            Event Activity (Last 24h)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="eventsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="threatGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,212,255,0.05)" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 10, fill: '#475569' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="events" stroke="#00d4ff" strokeWidth={2}
                fill="url(#eventsGrad)" name="Events" />
              <Area type="monotone" dataKey="threat" stroke="#ef4444" strokeWidth={1.5}
                fill="url(#threatGrad)" name="Threat %" strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Severity breakdown pie */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>
            <Crosshair className="w-4 h-4 inline mr-2" style={{ color: '#00d4ff' }} />
            Severity Distribution
          </h3>
          {severityData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs" style={{ color: '#334155' }}>
              No data today
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={severityData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  outerRadius={65} innerRadius={35} strokeWidth={0}>
                  {severityData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="space-y-1.5 mt-2">
            {severityData.map(({ name, value, color }) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span style={{ color: '#64748b' }}>{name}</span>
                </div>
                <span className="font-mono font-bold" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-2 gap-5">
        {/* Event type bar chart */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>
            <BarChart2 className="w-4 h-4 inline mr-2" style={{ color: '#00d4ff' }} />
            Event Types (Today)
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={typeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,212,255,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={120} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Count" radius={[0, 4, 4, 0]}>
                {typeData.map((_, i) => (
                  <Cell key={i} fill={`hsl(${190 + i * 20}, 80%, 55%)`} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top zones */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>
            <Map className="w-4 h-4 inline mr-2" style={{ color: '#00d4ff' }} />
            Top Activity Zones
          </h3>
          {(metrics?.top_zones || []).length === 0 ? (
            <div className="flex items-center justify-center h-40 text-xs" style={{ color: '#334155' }}>
              No zone data available
            </div>
          ) : (
            <div className="space-y-3">
              {(metrics?.top_zones || []).map((z: any, i: number) => {
                const maxCount = metrics?.top_zones[0]?.count || 1
                const pct = (z.count / maxCount) * 100
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: '#94a3b8' }}>{z.zone}</span>
                      <span className="font-mono" style={{ color: '#00d4ff' }}>{z.count}</span>
                    </div>
                    <div className="rounded overflow-hidden" style={{ height: 6, background: 'rgba(0,212,255,0.08)' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: i * 0.1, duration: 0.6 }}
                        style={{ height: '100%', background: `hsl(${190 - i * 15}, 80%, 55%)`, borderRadius: 3 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Heatmap */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: '#94a3b8' }}>
            <Map className="w-4 h-4 inline mr-2" style={{ color: '#ef4444' }} />
            Detection Heatmap
          </h3>
          <span className="text-xs" style={{ color: '#334155' }}>
            {(heatmap?.points || []).length} data points
          </span>
        </div>
        <div style={{ height: 280 }}>
          <HeatmapCanvas points={heatmap?.points || []} />
        </div>
      </div>
    </div>
  )
}
