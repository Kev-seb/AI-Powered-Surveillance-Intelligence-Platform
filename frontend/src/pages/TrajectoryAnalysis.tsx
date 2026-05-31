import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Activity, RefreshCw, BarChart2, Users,
  Filter, Play, Pause, Clock, TrendingUp,
} from 'lucide-react'
import { analyticsApi, eventsApi, videosApi } from '@/api/client'

interface TrackPoint { x: number; y: number; t: number; threat: number; trackId: number }
interface TrackPath { trackId: number; points: TrackPoint[]; maxThreat: number }

function ThreatBadge({ score }: { score: number }) {
  const color = score > 0.7 ? '#ef4444' : score > 0.4 ? '#f59e0b' : '#10b981'
  return (
    <span className="px-2 py-0.5 rounded text-xs font-mono"
      style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
      {(score * 100).toFixed(0)}%
    </span>
  )
}

// Draw trajectories on canvas
function TrajectoryCanvas({ tracks, selectedTrackId, showHeatmap, animate }: {
  tracks: TrackPath[]
  selectedTrackId: number | null
  showHeatmap: boolean
  animate: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const progressRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = (progress: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Grid
      ctx.strokeStyle = 'rgba(0,212,255,0.04)'
      ctx.lineWidth = 1
      for (let x = 0; x < canvas.width; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
      }
      for (let y = 0; y < canvas.height; y += 50) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
      }

      // Heatmap layer
      if (showHeatmap) {
        tracks.forEach(track => {
          track.points.forEach(pt => {
            const cx = pt.x * canvas.width
            const cy = pt.y * canvas.height
            const r = 25
            const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
            const alpha = Math.min(0.35, pt.threat * 0.4)
            grd.addColorStop(0, `rgba(239,68,68,${alpha})`)
            grd.addColorStop(0.5, `rgba(245,158,11,${alpha * 0.4})`)
            grd.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.fillStyle = grd
            ctx.fill()
          })
        })
      }

      // Draw trajectories
      tracks.forEach(track => {
        const isSelected = selectedTrackId === null || track.trackId === selectedTrackId
        if (!isSelected) return

        const color = track.maxThreat > 0.7 ? '#ef4444'
          : track.maxThreat > 0.4 ? '#f97316'
          : '#00d4ff'

        const visibleCount = animate
          ? Math.floor(track.points.length * progress)
          : track.points.length

        const pts = track.points.slice(0, Math.max(1, visibleCount))
        if (pts.length < 2) return

        // Draw path with gradient opacity
        for (let i = 1; i < pts.length; i++) {
          const t = i / pts.length
          ctx.beginPath()
          ctx.moveTo(pts[i - 1].x * canvas.width, pts[i - 1].y * canvas.height)
          ctx.lineTo(pts[i].x * canvas.width, pts[i].y * canvas.height)
          ctx.strokeStyle = color
          ctx.globalAlpha = 0.3 + t * 0.7
          ctx.lineWidth = selectedTrackId === track.trackId ? 2.5 : 1.5
          ctx.shadowColor = color
          ctx.shadowBlur = selectedTrackId === track.trackId ? 8 : 3
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0

        // Start dot (green)
        const start = pts[0]
        ctx.beginPath()
        ctx.arc(start.x * canvas.width, start.y * canvas.height, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#10b981'
        ctx.fill()

        // End dot (red pulsing)
        const end = pts[pts.length - 1]
        ctx.beginPath()
        ctx.arc(end.x * canvas.width, end.y * canvas.height, 5, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = 12
        ctx.fill()
        ctx.shadowBlur = 0

        // Track ID label
        ctx.font = 'bold 10px monospace'
        ctx.fillStyle = color
        ctx.fillText(`#${track.trackId}`, end.x * canvas.width + 7, end.y * canvas.height + 3)
      })
    }

    if (animate) {
      const loop = () => {
        progressRef.current = (progressRef.current + 0.005) % 1.05
        draw(Math.min(progressRef.current, 1))
        if (progressRef.current <= 1) {
          rafRef.current = requestAnimationFrame(loop)
        } else {
          progressRef.current = 0
          rafRef.current = requestAnimationFrame(loop)
        }
      }
      loop()
    } else {
      draw(1)
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [tracks, selectedTrackId, showHeatmap, animate])

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={506}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 8,
        background: '#030609',
      }}
    />
  )
}

export default function TrajectoryAnalysis() {
  const [selectedVideo, setSelectedVideo] = useState<string | undefined>()
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [animating, setAnimating] = useState(false)
  const [minThreat, setMinThreat] = useState(0)

  const { data: videos = [] } = useQuery({
    queryKey: ['videos'],
    queryFn: () => videosApi.list(),
  })

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['trajectory-events', selectedVideo],
    queryFn: () => eventsApi.list({ video_id: selectedVideo, per_page: 1000 }),
    select: d => d.items,
    enabled: true,
  })

  // Build track paths from events
  const tracks = useMemo<TrackPath[]>(() => {
    const byTrack: Record<number, TrackPoint[]> = {}
    events.forEach((ev: any) => {
      if (!ev.bbox || ev.track_id == null) return
      let { x, y, w, h } = ev.bbox

      const isNormalized = !(x > 1.0 || y > 1.0 || w > 1.0 || h > 1.0)
      if (!isNormalized) {
        // Find video resolution
        let baseW = 1280
        let baseH = 720
        const video = videos.find((v: any) => v.id === ev.video_id)
        if (video && video.resolution) {
          const [rw, rh] = video.resolution.split('x').map(Number)
          if (rw && rh) {
            baseW = rw
            baseH = rh
          }
        } else {
          // Guess based on coordinate values
          if (x > 1280 || y > 720 || (x + w) > 1280 || (y + h) > 720) {
            baseW = 1920
            baseH = 1080
          }
        }
        x /= baseW
        y /= baseH
        w /= baseW
        h /= baseH
      }

      const cx = x + w / 2
      const cy = y + h / 2
      if (!byTrack[ev.track_id]) byTrack[ev.track_id] = []
      byTrack[ev.track_id].push({
        x: cx, y: cy,
        t: ev.timestamp_secs || 0,
        threat: ev.threat_score,
        trackId: ev.track_id,
      })
    })
    return Object.entries(byTrack)
      .map(([id, pts]) => {
        const sorted = pts.sort((a, b) => a.t - b.t)
        const maxThreat = Math.max(...pts.map(p => p.threat))
        return { trackId: Number(id), points: sorted, maxThreat }
      })
      .filter(t => t.maxThreat >= minThreat)
      .sort((a, b) => b.maxThreat - a.maxThreat)
  }, [events, minThreat, videos])

  const { data: activityData = [] } = useQuery({
    queryKey: ['person-activity'],
    queryFn: () => analyticsApi.personActivity(),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Trajectory Analysis</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Visualize person movement paths and behavioral patterns
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setAnimating(a => !a)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm"
            style={{
              background: animating ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)',
              color: animating ? '#7c3aed' : '#475569',
              border: '1px solid rgba(124,58,237,0.2)',
            }}>
            {animating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {animating ? 'Pause' : 'Animate'}
          </button>
          <button onClick={() => refetch()}
            className="p-2 rounded-lg"
            style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="glass-card p-4 flex flex-wrap gap-4 items-center">
        <div>
          <label className="text-xs mb-1 block" style={{ color: '#475569' }}>Video Source</label>
          <select
            className="asip-input text-sm"
            value={selectedVideo || ''}
            onChange={e => { setSelectedVideo(e.target.value || undefined); setSelectedTrackId(null) }}
            style={{ width: 200 }}
          >
            <option value="">All Videos</option>
            {videos.filter((v: any) => v.status === 'completed').map((v: any) => (
              <option key={v.id} value={v.id}>{v.original_name || v.filename}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs mb-1 block" style={{ color: '#475569' }}>
            Min Threat: {Math.round(minThreat * 100)}%
          </label>
          <input
            type="range" min="0" max="0.9" step="0.1"
            value={minThreat}
            onChange={e => setMinThreat(Number(e.target.value))}
            className="w-32"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHeatmap(h => !h)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{
              background: showHeatmap ? 'rgba(239,68,68,0.1)' : 'transparent',
              color: showHeatmap ? '#ef4444' : '#475569',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            <Activity className="w-3.5 h-3.5" /> Heatmap
          </button>
          <button
            onClick={() => setSelectedTrackId(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'rgba(255,255,255,0.04)', color: '#475569' }}
          >
            Show All Tracks
          </button>
        </div>

        <div className="ml-auto flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: '#10b981' }} />
            <span style={{ color: '#64748b' }}>Start</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: '#ef4444' }} />
            <span style={{ color: '#64748b' }}>End (High)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: '#00d4ff' }} />
            <span style={{ color: '#64748b' }}>End (Low)</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-5">
        {/* Main canvas */}
        <div className="col-span-3 glass-card p-2 overflow-hidden" style={{ aspectRatio: '16/9' }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="spinner" />
            </div>
          ) : tracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Activity className="w-12 h-12 mb-3 opacity-10" style={{ color: '#00d4ff' }} />
              <p className="text-sm" style={{ color: '#334155' }}>No trajectory data</p>
              <p className="text-xs mt-1" style={{ color: '#1e293b' }}>
                Process a video to generate movement paths
              </p>
            </div>
          ) : (
            <TrajectoryCanvas
              tracks={tracks}
              selectedTrackId={selectedTrackId}
              showHeatmap={showHeatmap}
              animate={animating}
            />
          )}
        </div>

        {/* Track list */}
        <div className="glass-card overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b flex items-center gap-2"
            style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
            <Users className="w-3.5 h-3.5" style={{ color: '#00d4ff' }} />
            <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>
              Tracks ({tracks.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tracks.length === 0 ? (
              <div className="py-8 text-center text-xs" style={{ color: '#334155' }}>
                No tracks to display
              </div>
            ) : (
              tracks.map(track => (
                <motion.div
                  key={track.trackId}
                  whileHover={{ backgroundColor: 'rgba(0,212,255,0.04)' }}
                  onClick={() => setSelectedTrackId(
                    selectedTrackId === track.trackId ? null : track.trackId
                  )}
                  className="flex items-center gap-2 px-3 py-2 border-b cursor-pointer"
                  style={{
                    borderColor: 'rgba(255,255,255,0.04)',
                    background: selectedTrackId === track.trackId
                      ? 'rgba(0,212,255,0.06)' : 'transparent',
                  }}
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: track.maxThreat > 0.7 ? '#ef4444'
                        : track.maxThreat > 0.4 ? '#f97316' : '#00d4ff'
                    }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono" style={{ color: '#e2e8f0' }}>
                      Track #{track.trackId}
                    </p>
                    <p className="text-xs" style={{ color: '#334155' }}>
                      {track.points.length} pts
                    </p>
                  </div>
                  <ThreatBadge score={track.maxThreat} />
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
