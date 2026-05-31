import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Map, Plus, Trash2, Edit3, CheckCircle2, X,
  Save, RefreshCw, BarChart2, Users, AlertTriangle,
  Eye, EyeOff, Layers,
} from 'lucide-react'
import { zonesApi, api } from '@/api/client'
import toast from 'react-hot-toast'

interface ZonePoint { x: number; y: number }
interface Zone {
  id: string
  name: string
  color: string
  polygon: ZonePoint[]
  alert_threshold: number
  max_capacity: number | null
  created_at: string
}

const ZONE_COLORS = [
  '#00d4ff', '#7c3aed', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
]

function ZoneAnalyticsCard({ zone }: { zone: any }) {
  const threatPct = Math.round((zone.avg_threat || 0) * 100)
  const color = zone.avg_threat > 0.7 ? '#ef4444' : zone.avg_threat > 0.4 ? '#f59e0b' : '#10b981'
  return (
    <div className="glass-card p-4" style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>{zone.zone_name}</p>
        <span className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
          {threatPct}% threat
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="font-bold text-lg" style={{ color: '#00d4ff' }}>{zone.event_count}</p>
          <p style={{ color: '#475569' }}>Events</p>
        </div>
        <div>
          <p className="font-bold text-lg" style={{ color: '#7c3aed' }}>{zone.unique_persons}</p>
          <p style={{ color: '#475569' }}>Persons</p>
        </div>
        <div>
          <p className="font-bold text-lg" style={{ color }}>
            {Math.round((zone.max_threat || 0) * 100)}%
          </p>
          <p style={{ color: '#475569' }}>Peak</p>
        </div>
      </div>
      <div className="mt-3">
        <div className="h-1.5 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div style={{ width: `${threatPct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
        </div>
      </div>
    </div>
  )
}

// Interactive polygon editor canvas
function ZoneCanvas({
  zones,
  isDrawing,
  currentPoints,
  currentColor,
  onPointAdd,
  onComplete,
  onCancel,
}: {
  zones: Zone[]
  isDrawing: boolean
  currentPoints: ZonePoint[]
  currentColor: string
  onPointAdd: (pt: ZonePoint) => void
  onComplete: () => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mousePos, setMousePos] = useState<ZonePoint | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw a grid background
    ctx.strokeStyle = 'rgba(0,212,255,0.05)'
    ctx.lineWidth = 1
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
    }

    // Draw existing zones
    zones.forEach(zone => {
      if (zone.polygon.length < 3) return
      const pts = zone.polygon.map(p => ({
        x: p.x * canvas.width,
        y: p.y * canvas.height,
      }))
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.closePath()
      ctx.fillStyle = `${zone.color}20`
      ctx.fill()
      ctx.strokeStyle = zone.color
      ctx.lineWidth = 2
      ctx.shadowColor = zone.color
      ctx.shadowBlur = 6
      ctx.stroke()
      ctx.shadowBlur = 0

      // Label
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
      ctx.font = 'bold 12px monospace'
      ctx.fillStyle = zone.color
      ctx.textAlign = 'center'
      ctx.fillText(zone.name, cx, cy)
    })

    // Draw current polygon being drawn
    if (isDrawing && currentPoints.length > 0) {
      const pts = currentPoints.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }))
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      if (mousePos) {
        ctx.lineTo(mousePos.x * canvas.width, mousePos.y * canvas.height)
      }
      ctx.strokeStyle = currentColor
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.stroke()
      ctx.setLineDash([])

      // Draw vertices
      pts.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = i === 0 ? '#ffffff' : currentColor
        ctx.fill()
        ctx.strokeStyle = currentColor
        ctx.lineWidth = 2
        ctx.stroke()
      })
    }
  }, [zones, isDrawing, currentPoints, currentColor, mousePos])

  useEffect(() => { draw() }, [draw])

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): ZonePoint => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const pt = getCanvasCoords(e)
    // Close if clicking near first point
    if (currentPoints.length >= 3) {
      const first = currentPoints[0]
      const dx = Math.abs(pt.x - first.x)
      const dy = Math.abs(pt.y - first.y)
      if (dx < 0.025 && dy < 0.025) {
        onComplete()
        return
      }
    }
    onPointAdd(pt)
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={800}
        height={450}
        onClick={handleClick}
        onMouseMove={e => { if (isDrawing) setMousePos(getCanvasCoords(e)) }}
        style={{
          width: '100%',
          height: '100%',
          cursor: isDrawing ? 'crosshair' : 'default',
          borderRadius: 8,
          background: '#050810',
        }}
      />
      {isDrawing && currentPoints.length >= 3 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
          <button
            onClick={onComplete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Close & Save Zone
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}
      {isDrawing && currentPoints.length === 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg text-xs"
          style={{ background: 'rgba(0,212,255,0.1)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}>
          Click to place zone vertices • Click first point to close
        </div>
      )}
    </div>
  )
}

export default function ZoneIntelligence() {
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentPoints, setCurrentPoints] = useState<ZonePoint[]>([])
  const [selectedColor, setSelectedColor] = useState(ZONE_COLORS[0])
  const [zoneName, setZoneName] = useState('')
  const [alertThreshold, setAlertThreshold] = useState(0.7)
  const [maxCapacity, setMaxCapacity] = useState<number | ''>('')
  const [showAnalytics, setShowAnalytics] = useState(true)
  const qc = useQueryClient()

  const { data: zones = [], isLoading } = useQuery<Zone[]>({
    queryKey: ['zones'],
    queryFn: zonesApi.list,
    refetchInterval: 10000,
  })

  const { data: analytics = [] } = useQuery({
    queryKey: ['zone-analytics'],
    queryFn: zonesApi.analytics,
    refetchInterval: 30000,
  })

  const createMutation = useMutation({
    mutationFn: (zone: any) => zonesApi.create(zone),
    onSuccess: () => {
      toast.success('Zone created')
      qc.invalidateQueries({ queryKey: ['zones'] })
      resetDrawing()
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed to create zone'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => zonesApi.delete(id),
    onSuccess: () => {
      toast.success('Zone deleted')
      qc.invalidateQueries({ queryKey: ['zones'] })
    },
  })

  const resetDrawing = () => {
    setCurrentPoints([])
    setIsDrawing(false)
    setZoneName('')
    setAlertThreshold(0.7)
    setMaxCapacity('')
  }

  const handleComplete = () => {
    if (currentPoints.length < 3) { toast.error('Need at least 3 points'); return }
    if (!zoneName.trim()) { toast.error('Zone name required'); return }
    createMutation.mutate({
      name: zoneName.trim(),
      color: selectedColor,
      polygon: currentPoints,
      alert_threshold: alertThreshold,
      max_capacity: maxCapacity || null,
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Zone Intelligence</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Draw detection zones, monitor occupancy, and set alert thresholds
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAnalytics(a => !a)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm"
            style={{
              background: showAnalytics ? 'rgba(0,212,255,0.1)' : 'transparent',
              color: showAnalytics ? '#00d4ff' : '#475569',
              border: '1px solid rgba(0,212,255,0.2)',
            }}
          >
            <BarChart2 className="w-4 h-4" /> Analytics
          </button>
          <button
            onClick={() => { resetDrawing(); setIsDrawing(true) }}
            disabled={isDrawing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm btn-glow disabled:opacity-40"
          >
            <Plus className="w-4 h-4" /> Draw Zone
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Canvas + controls */}
        <div className="col-span-2 space-y-4">
          {/* Drawing toolbar */}
          {isDrawing && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-4"
            >
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#475569' }}>Zone Name *</label>
                  <input
                    value={zoneName}
                    onChange={e => setZoneName(e.target.value)}
                    className="asip-input text-sm"
                    placeholder="e.g. Main Entrance"
                    style={{ width: 160 }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#475569' }}>Alert Threshold</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={alertThreshold}
                      onChange={e => setAlertThreshold(Number(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-xs font-mono" style={{ color: '#00d4ff' }}>
                      {Math.round(alertThreshold * 100)}%
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#475569' }}>Max Capacity</label>
                  <input
                    type="number" min="1"
                    value={maxCapacity}
                    onChange={e => setMaxCapacity(e.target.value ? Number(e.target.value) : '')}
                    className="asip-input text-sm"
                    placeholder="Optional"
                    style={{ width: 90 }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#475569' }}>Color</label>
                  <div className="flex gap-1.5">
                    {ZONE_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setSelectedColor(c)}
                        className="w-5 h-5 rounded-full transition-transform"
                        style={{
                          background: c,
                          transform: selectedColor === c ? 'scale(1.3)' : 'scale(1)',
                          boxShadow: selectedColor === c ? `0 0 8px ${c}` : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>
                <button
                  onClick={resetDrawing}
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs"
                  style={{ color: '#475569', background: 'rgba(255,255,255,0.04)' }}
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </motion.div>
          )}

          {/* Zone canvas */}
          <div className="glass-card p-1 overflow-hidden">
            <ZoneCanvas
              zones={zones}
              isDrawing={isDrawing}
              currentPoints={currentPoints}
              currentColor={selectedColor}
              onPointAdd={pt => setCurrentPoints(prev => [...prev, pt])}
              onComplete={handleComplete}
              onCancel={resetDrawing}
            />
          </div>

          <p className="text-xs text-center" style={{ color: '#1e293b' }}>
            Click canvas to place zone vertices • At least 3 points required • Click first point to close polygon
          </p>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Zone list */}
          <div className="glass-card overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2"
              style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
              <Layers className="w-4 h-4" style={{ color: '#00d4ff' }} />
              <span className="text-sm font-medium" style={{ color: '#94a3b8' }}>
                Zones ({zones.length})
              </span>
              <button onClick={() => qc.invalidateQueries({ queryKey: ['zones'] })}
                className="ml-auto p-1 rounded">
                <RefreshCw className="w-3 h-3" style={{ color: '#334155' }} />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {isLoading ? (
                <div className="flex justify-center py-6"><div className="spinner" /></div>
              ) : zones.length === 0 ? (
                <div className="py-8 text-center">
                  <Map className="w-8 h-8 mx-auto mb-2 opacity-10" style={{ color: '#00d4ff' }} />
                  <p className="text-xs" style={{ color: '#334155' }}>No zones defined</p>
                  <p className="text-xs mt-1" style={{ color: '#1e293b' }}>Click "Draw Zone" to start</p>
                </div>
              ) : (
                zones.map((zone) => (
                  <div key={zone.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b group"
                    style={{ borderColor: 'rgba(0,212,255,0.04)' }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: zone.color, boxShadow: `0 0 6px ${zone.color}` }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>{zone.name}</p>
                      <p className="text-xs" style={{ color: '#334155' }}>
                        {zone.polygon.length} pts · threshold {Math.round(zone.alert_threshold * 100)}%
                        {zone.max_capacity ? ` · cap ${zone.max_capacity}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteMutation.mutate(zone.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                      style={{ color: '#ef4444' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Zone analytics */}
          {showAnalytics && analytics.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider px-1"
                style={{ color: '#334155' }}>Zone Activity (24h)</p>
              {analytics.map((z: any) => (
                <ZoneAnalyticsCard key={z.zone_name} zone={z} />
              ))}
            </div>
          )}

          {showAnalytics && analytics.length === 0 && (
            <div className="glass-card p-6 text-center">
              <BarChart2 className="w-8 h-8 mx-auto mb-2 opacity-10" style={{ color: '#00d4ff' }} />
              <p className="text-xs" style={{ color: '#334155' }}>No zone activity data yet</p>
              <p className="text-xs mt-1" style={{ color: '#1e293b' }}>Activity will appear after video processing</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
