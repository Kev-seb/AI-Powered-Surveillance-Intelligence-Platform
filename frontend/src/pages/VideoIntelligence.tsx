import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, Play, Loader2, CheckCircle2, XCircle,
  Clock, Film, Cpu, RefreshCw, ZoomIn, ZoomOut,
  SkipBack, SkipForward, Pause, Map, Layers,
  Target, Activity, Trash2,
} from 'lucide-react'
import { videosApi, eventsApi, analyticsApi } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

function StatusBadge({ status }: { status: string }) {
  const config = {
    transcoding: { color: '#6366f1', icon: Loader2, animate: true },
    pending:    { color: '#64748b', icon: Clock, animate: false },
    queued:     { color: '#f59e0b', icon: Clock, animate: false },
    processing: { color: '#00d4ff', icon: Cpu, animate: false },
    completed:  { color: '#10b981', icon: CheckCircle2, animate: false },
    failed:     { color: '#ef4444', icon: XCircle, animate: false },
  }[status] || { color: '#64748b', icon: Clock, animate: false }

  const Icon = config.icon
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: config.color }}>
      <Icon className={`w-3.5 h-3.5 ${config.animate ? 'animate-spin' : ''}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// Canvas overlay that draws bounding boxes and track IDs
function VideoOverlay({ events, videoEl, playing }: {
  events: any[], videoEl: HTMLVideoElement | null, playing: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Class-specific color and label mapping
  const getClassStyle = (className: string, severity: string) => {
    if (className === 'face') return { color: '#a78bfa', label: 'Face' }
    if (className === 'car') return { color: '#f59e0b', label: 'Car' }
    if (className === 'truck') return { color: '#f97316', label: 'Truck' }
    if (className === 'bus') return { color: '#fb923c', label: 'Bus' }
    if (className === 'motorcycle') return { color: '#fbbf24', label: 'Moto' }
    if (className === 'bicycle') return { color: '#34d399', label: 'Bicycle' }
    // person — use severity color
    const col = severity === 'critical' ? '#ef4444'
      : severity === 'high' ? '#f97316'
      : severity === 'medium' ? '#f59e0b'
      : '#00d4ff'
    return { color: col, label: 'Person' }
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoEl
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const vWidth = video.videoWidth
    const vHeight = video.videoHeight
    if (!vWidth || !vHeight) return

    canvas.width = vWidth
    canvas.height = vHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const currentTime = video.currentTime
    const visibleEvents = events.filter(ev =>
      ev.timestamp_secs != null &&
      Math.abs(ev.timestamp_secs - currentTime) < 0.8
    )

    visibleEvents.forEach(ev => {
      if (!ev.bbox) return
      const { x, y, w, h } = ev.bbox
      const isNormalized = !(x > 1.0 || y > 1.0 || w > 1.0 || h > 1.0)
      const cx = isNormalized ? x * canvas.width : x
      const cy = isNormalized ? y * canvas.height : y
      const cw = isNormalized ? w * canvas.width : w
      const ch = isNormalized ? h * canvas.height : h

      const rawClass = ev.metadata?.class_name || 'person'
      const { color, label: classLabel } = getClassStyle(rawClass, ev.severity)
      const isFace = rawClass === 'face'
      const isPerson = rawClass === 'person'
      const isVehicle = ['car', 'truck', 'bus', 'motorcycle', 'bicycle'].includes(rawClass)

      // 1. Draw movement trail for persons and vehicles
      if (isPerson || isVehicle) {
        const trailPoints = events
          .filter(e => e.track_id === ev.track_id && e.timestamp_secs <= currentTime && e.timestamp_secs >= currentTime - 3.0)
          .sort((a, b) => a.timestamp_secs - b.timestamp_secs)

        if (trailPoints.length > 1) {
          ctx.beginPath()
          ctx.lineWidth = 2
          ctx.strokeStyle = color
          ctx.setLineDash([4, 4])
          ctx.globalAlpha = 0.5
          ctx.shadowColor = color
          ctx.shadowBlur = 4
          trailPoints.forEach((pt, idx) => {
            const pBox = pt.bbox
            const pIsNorm = !(pBox.x > 1.0 || pBox.y > 1.0 || pBox.w > 1.0 || pBox.h > 1.0)
            const px = pIsNorm ? pBox.x * canvas.width : pBox.x
            const py = pIsNorm ? pBox.y * canvas.height : pBox.y
            const pw = pIsNorm ? pBox.w * canvas.width : pBox.w
            const ph = pIsNorm ? pBox.h * canvas.height : pBox.h
            const pcx = px + pw / 2
            const pcy = py + ph / 2
            if (idx === 0) { ctx.moveTo(pcx, pcy) } else { ctx.lineTo(pcx, pcy) }
          })
          ctx.stroke()
          ctx.setLineDash([])
          ctx.globalAlpha = 1.0
          ctx.shadowBlur = 0
        }
      }

      // 2. Special rendering per class
      if (isPerson) {
        // Pulsing ellipse at feet
        const pulse = Math.sin(Date.now() / 200)
        const feetX = cx + cw / 2
        const feetY = cy + ch
        ctx.beginPath()
        ctx.ellipse(feetX, feetY, (cw / 2) * (1 + 0.12 * pulse), 5 * (1 + 0.12 * pulse), 0, 0, Math.PI * 2)
        ctx.strokeStyle = `${color}cc`
        ctx.lineWidth = 1.5
        ctx.fillStyle = `${color}18`
        ctx.fill()
        ctx.stroke()
        // Crosshair on body center
        const ccx = cx + cw / 2
        const ccy = cy + ch / 2
        ctx.beginPath()
        ctx.arc(ccx, ccy, 7, 0, Math.PI * 2)
        ctx.strokeStyle = '#ffffff99'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(ccx - 12, ccy); ctx.lineTo(ccx + 12, ccy)
        ctx.moveTo(ccx, ccy - 12); ctx.lineTo(ccx, ccy + 12)
        ctx.stroke()
      } else if (isFace) {
        // Pulsing circle overlay for face
        const pulse = Math.sin(Date.now() / 300) * 0.5 + 0.5
        const fcx = cx + cw / 2
        const fcy = cy + ch / 2
        const fr = Math.min(cw, ch) / 2 + 4
        ctx.beginPath()
        ctx.arc(fcx, fcy, fr * (1 + 0.08 * pulse), 0, Math.PI * 2)
        ctx.strokeStyle = `${color}99`
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 3])
        ctx.stroke()
        ctx.setLineDash([])
        // Scan line sweep
        const angle = (Date.now() / 600) % (Math.PI * 2)
        ctx.beginPath()
        ctx.moveTo(fcx, fcy)
        ctx.arc(fcx, fcy, fr, angle - 0.3, angle)
        ctx.closePath()
        ctx.fillStyle = `${color}22`
        ctx.fill()
      }

      // 3. Bounding box with glow
      ctx.shadowColor = color
      ctx.shadowBlur = isFace ? 12 : 8
      ctx.strokeStyle = color
      ctx.lineWidth = isFace ? 1.5 : 2
      ctx.strokeRect(cx, cy, cw, ch)
      ctx.fillStyle = `${color}0d`
      ctx.fillRect(cx, cy, cw, ch)
      ctx.shadowBlur = 0

      // 4. Corner markers (skip tiny face boxes)
      if (!isFace && cw > 20 && ch > 20) {
        const cornerLen = Math.min(cw, ch) * 0.2
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(cx, cy + cornerLen); ctx.lineTo(cx, cy); ctx.lineTo(cx + cornerLen, cy)
        ctx.moveTo(cx + cw - cornerLen, cy); ctx.lineTo(cx + cw, cy); ctx.lineTo(cx + cw, cy + cornerLen)
        ctx.moveTo(cx, cy + ch - cornerLen); ctx.lineTo(cx, cy + ch); ctx.lineTo(cx + cornerLen, cy + ch)
        ctx.moveTo(cx + cw - cornerLen, cy + ch); ctx.lineTo(cx + cw, cy + ch); ctx.lineTo(cx + cw, cy + ch - cornerLen)
        ctx.stroke()
      }

      // 5. Label with class + track id + confidence + threat
      const conf = (ev.confidence * 100).toFixed(0)
      const threat = (ev.threat_score * 100).toFixed(0)
      const label = isFace
        ? (ev.person_name ? `Face: ${ev.person_name}  ${conf}%` : `Face #${ev.track_id}  ${conf}%`)
        : `${classLabel} #${ev.track_id}  ${conf}%  ⚡${threat}%`
      ctx.font = isFace ? 'bold 10px monospace' : 'bold 11px monospace'
      const textW = ctx.measureText(label).width + 10
      const labelY = cy > 22 ? cy - 2 : cy + ch + 18
      ctx.fillStyle = `${color}dd`
      ctx.fillRect(cx, labelY - 16, textW, 17)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, cx + 5, labelY - 3)
    })
  }, [events, videoEl])

  useEffect(() => {
    if (!videoEl) return
    const raf = { id: 0 }
    const loop = () => { draw(); raf.id = requestAnimationFrame(loop) }
    if (playing) { loop() }
    else { draw() }
    return () => cancelAnimationFrame(raf.id)
  }, [playing, draw, videoEl])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
      }}
    />
  )
}


// Timeline scrubber
function EventTimeline({ events, duration, onSeek }: {
  events: any[], duration: number, onSeek: (t: number) => void
}) {
  if (!duration || events.length === 0) return null
  return (
    <div className="relative h-6 rounded overflow-hidden cursor-pointer"
      style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.1)' }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const ratio = (e.clientX - rect.left) / rect.width
        onSeek(ratio * duration)
      }}
    >
      {events.map((ev, i) => {
        const left = ((ev.timestamp_secs || 0) / duration) * 100
        const color = ev.severity === 'critical' ? '#ef4444'
          : ev.severity === 'high' ? '#f97316'
          : ev.severity === 'medium' ? '#f59e0b' : '#10b981'
        return (
          <div key={i} style={{
            position: 'absolute', left: `${left}%`,
            top: 0, bottom: 0, width: 3,
            background: color, opacity: 0.7,
          }} title={`${ev.event_type} @ ${ev.timestamp_secs?.toFixed(1)}s`} />
        )
      })}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs" style={{ color: '#475569' }}>Event Timeline — click to seek</span>
      </div>
    </div>
  )
}

export default function VideoIntelligence() {
  const { token, user } = useAuthStore()
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [activeTab, setActiveTab] = useState<'events' | 'heatmap' | 'timeline'>('events')
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const qc = useQueryClient()

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ['videos'],
    queryFn: () => videosApi.list(),
    refetchInterval: 5000,
  })

  const selectedVideo = videos.find((v: any) => v.id === selectedVideoId)

  const { data: events = [] } = useQuery({
    queryKey: ['events', selectedVideoId],
    queryFn: () => eventsApi.list({ video_id: selectedVideoId, per_page: 500 }),
    enabled: !!selectedVideoId,
    select: (d) => d.items,
    refetchInterval: selectedVideo?.status === 'processing' ? 5000 : false,
  })

  const { data: timeline = [] } = useQuery({
    queryKey: ['timeline', selectedVideoId],
    queryFn: () => analyticsApi.timeline(selectedVideoId!),
    enabled: !!selectedVideoId,
    refetchInterval: selectedVideo?.status === 'processing' ? 5000 : false,
  })

  const { data: heatmapData } = useQuery({
    queryKey: ['heatmap', selectedVideoId],
    queryFn: () => analyticsApi.heatmap(selectedVideoId!),
    enabled: !!selectedVideoId && showHeatmap,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => videosApi.upload(file),
    onSuccess: () => { toast.success('Video uploaded'); qc.invalidateQueries({ queryKey: ['videos'] }) },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Upload failed'),
  })

  const [confThresholds, setConfThresholds] = useState<Record<string, number>>({})
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)

  const processMutation = useMutation({
    mutationFn: ({ id, options }: { id: string, options: any }) => videosApi.process(id, options),
    onSuccess: () => { toast.success('Processing started'); qc.invalidateQueries({ queryKey: ['videos'] }) },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed to start'),
  })

  const deleteVideoMutation = useMutation({
    mutationFn: (id: string) => videosApi.delete(id),
    onSuccess: (_, deletedId) => {
      toast.success('Video deleted successfully')
      qc.invalidateQueries({ queryKey: ['videos'] })
      if (selectedVideoId === deletedId) {
        setSelectedVideoId(null)
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Deletion failed'),
  })

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('video/')) { toast.error('Please select a video file'); return }
    uploadMutation.mutate(file)
  }

  const [playbackRate, setPlaybackRate] = useState(1.0)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate
    }
  }, [playbackRate, selectedVideoId])

  useEffect(() => {
    setPlaybackRate(1.0)
    setVideoCurrentTime(0)
    setVideoDuration(0)
  }, [selectedVideoId])

  // Invalidate and refetch queries when selected video completes processing
  useEffect(() => {
    if (selectedVideoId && selectedVideo?.status === 'completed') {
      qc.invalidateQueries({ queryKey: ['events', selectedVideoId] })
      qc.invalidateQueries({ queryKey: ['timeline', selectedVideoId] })
      qc.invalidateQueries({ queryKey: ['heatmap', selectedVideoId] })
    }
  }, [selectedVideo?.status, selectedVideoId, qc])

  const stepFrame = (direction: 'prev' | 'next') => {
    if (!videoRef.current) return
    videoRef.current.pause()
    setPlaying(false)
    const frameTime = 1 / 30 // assume 30 FPS
    videoRef.current.currentTime = Math.max(
      0,
      Math.min(
        videoRef.current.duration || 0,
        videoRef.current.currentTime + (direction === 'next' ? frameTime : -frameTime)
      )
    )
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (playing) { videoRef.current.pause(); setPlaying(false) }
    else { videoRef.current.play(); setPlaying(true) }
  }

  const seekBy = (secs: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + secs)
  }

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '00:00:00'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = Math.floor(secs % 60)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // Severity breakdown stats
  const criticalCount = events.filter((e: any) => e.severity === 'critical').length
  const highCount = events.filter((e: any) => e.severity === 'high').length
  const avgThreat = events.length
    ? (events.reduce((s: number, e: any) => s + e.threat_score, 0) / events.length * 100).toFixed(0)
    : '0'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Video Intelligence</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Upload, analyze, and review surveillance footage with AI-powered detection overlays
          </p>
        </div>
        {selectedVideoId && (
          <div className="flex items-center gap-3">
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 rounded" style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444440' }}>
                {criticalCount} Critical
              </span>
              <span className="px-2 py-1 rounded" style={{ background: '#f9731620', color: '#f97316', border: '1px solid #f9731640' }}>
                {highCount} High
              </span>
              <span className="px-2 py-1 rounded" style={{ background: '#00d4ff20', color: '#00d4ff', border: '1px solid #00d4ff40' }}>
                Avg {avgThreat}%
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Upload + Video List */}
        <div className="space-y-4">
          <motion.div
            whileHover={{ scale: 1.01 }}
            className={`glass-card p-6 text-center cursor-pointer transition-all ${isDragging ? 'border-cyan-400' : ''}`}
            style={{ borderStyle: 'dashed', borderWidth: 1.5 }}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setIsDragging(false)
              const file = e.dataTransfer.files[0]
              if (file) handleFileSelect(file)
            }}
          >
            <input ref={fileRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
            {uploadMutation.isPending ? (
              <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: '#00d4ff' }} />
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: '#00d4ff', opacity: 0.7 }} />
                <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>Drop video or click</p>
                <p className="text-xs mt-1" style={{ color: '#334155' }}>MP4, AVI, MOV • Max 500MB</p>
              </>
            )}
          </motion.div>

          <div className="glass-card overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
              <Film className="w-4 h-4" style={{ color: '#00d4ff' }} />
              <span className="text-sm font-medium" style={{ color: '#94a3b8' }}>Videos ({videos.length})</span>
            </div>
            <div className="max-h-[calc(100vh-420px)] overflow-y-auto">
              {isLoading ? (
                <div className="flex justify-center py-8"><div className="spinner" /></div>
              ) : videos.length === 0 ? (
                <p className="text-center py-8 text-xs" style={{ color: '#334155' }}>No videos uploaded</p>
              ) : (
                videos.map((video: any) => (
                  <motion.div
                    key={video.id}
                    whileHover={{ backgroundColor: 'rgba(0,212,255,0.04)' }}
                    onClick={() => setSelectedVideoId(video.id)}
                    className="px-4 py-3 cursor-pointer border-b"
                    style={{
                      borderColor: 'rgba(0,212,255,0.04)',
                      background: selectedVideoId === video.id ? 'rgba(0,212,255,0.06)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium truncate" style={{ color: '#e2e8f0', maxWidth: '60%' }}>
                        {video.original_name || video.filename}
                      </p>
                      <StatusBadge status={video.status} />
                    </div>
                    {video.status === 'processing' && (
                      <div className="threat-meter mt-1.5">
                        <div className="threat-fill" style={{ width: `${(video.progress || 0) * 100}%`, background: '#00d4ff' }} />
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex gap-3">
                        <span className="text-xs" style={{ color: '#334155' }}>{video.resolution || '—'}</span>
                        <span className="text-xs" style={{ color: '#334155' }}>
                          {video.duration_secs ? `${Math.round(video.duration_secs)}s` : '—'}
                        </span>
                      </div>
                      {user && ['admin', 'analyst', 'operator'].includes(user.role) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm(`Are you sure you want to delete video "${video.original_name || video.filename}" and all its data?`)) {
                              deleteVideoMutation.mutate(video.id)
                            }
                          }}
                          className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors flex items-center justify-center"
                          title="Delete video"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {video.status === 'pending' && (
                      <div className="mt-2 space-y-2 p-2 rounded bg-slate-950/60 border border-slate-800/80">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Confidence Threshold:</span>
                          <span className="font-mono text-cyan-400 font-bold">
                            {Math.round((confThresholds[video.id] ?? 0.35) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.10"
                          max="0.90"
                          step="0.05"
                          value={confThresholds[video.id] ?? 0.35}
                          onChange={(e) => {
                            e.stopPropagation()
                            setConfThresholds(prev => ({ ...prev, [video.id]: parseFloat(e.target.value) }))
                          }}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            processMutation.mutate({
                              id: video.id,
                              options: {
                                yolo_confidence: confThresholds[video.id] ?? 0.35,
                                enable_face_recognition: true,
                                enable_behavior_analysis: true
                              }
                            })
                          }}
                          className="btn-glow py-1 px-3 text-xs w-full"
                          disabled={processMutation.isPending}
                        >
                          <Play className="w-3 h-3 inline mr-1" /> Process with AI
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Player + Events */}
        <div className="col-span-2 space-y-4">
          {/* Video Player */}
          {selectedVideoId && selectedVideo?.status === 'completed' ? (
            <div className="glass-card overflow-hidden">
              {/* Player controls bar */}
              <div className="px-4 py-2.5 border-b flex items-center gap-3" style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
                <button onClick={togglePlay} className="p-1.5 rounded hover:bg-white/10" title={playing ? "Pause" : "Play"}>
                  {playing ? <Pause className="w-4 h-4" style={{ color: '#00d4ff' }} />
                    : <Play className="w-4 h-4" style={{ color: '#00d4ff' }} />}
                </button>
                <button onClick={() => seekBy(-5)} className="p-1 rounded hover:bg-white/5" title="Rewind 5s">
                  <SkipBack className="w-3.5 h-3.5" style={{ color: '#475569' }} />
                </button>
                <button onClick={() => stepFrame('prev')} title="Previous Frame" className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-cyan-400 flex items-center gap-0.5">
                  <SkipBack className="w-3 h-3" />
                  <span className="text-[10px] font-mono font-bold leading-none">F-</span>
                </button>
                <button onClick={() => stepFrame('next')} title="Next Frame" className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-cyan-400 flex items-center gap-0.5">
                  <span className="text-[10px] font-mono font-bold leading-none">F+</span>
                  <SkipForward className="w-3 h-3" />
                </button>
                <button onClick={() => seekBy(5)} className="p-1 rounded hover:bg-white/5" title="Fast Forward 5s">
                  <SkipForward className="w-3.5 h-3.5" style={{ color: '#475569' }} />
                </button>
                <div className="flex-1" />
                <div className="flex items-center gap-2 mr-2">
                  <span className="text-[11px]" style={{ color: '#64748b' }}>Speed:</span>
                  <input
                    type="range"
                    min="0.25"
                    max="4.0"
                    step="0.25"
                    value={playbackRate}
                    onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                    className="w-20 h-1 rounded-lg bg-slate-800 appearance-none cursor-pointer accent-cyan-400"
                    title={`Playback speed: ${playbackRate}x`}
                  />
                  <span className="text-xs font-mono font-semibold" style={{ color: '#00d4ff', width: '32px' }}>
                    {playbackRate.toFixed(2)}x
                  </span>
                </div>
                <button
                  onClick={() => setShowOverlay(!showOverlay)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                  style={{
                    background: showOverlay ? 'rgba(0,212,255,0.15)' : 'transparent',
                    color: showOverlay ? '#00d4ff' : '#475569',
                    border: '1px solid rgba(0,212,255,0.2)',
                  }}
                >
                  <Layers className="w-3 h-3" /> Overlay
                </button>
                <span className="text-xs font-mono" style={{ color: '#334155' }}>
                  {events.length} detections
                </span>
              </div>

               {/* Video */}
              <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
                <video
                  ref={videoRef}
                  className="w-full h-full object-contain"
                  src={`/api/v1/videos/${selectedVideoId}/stream?token=${token}`}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
                  controls={false}
                />
                {showOverlay && (
                  <VideoOverlay events={events} videoEl={videoRef.current} playing={playing} />
                )}
              </div>

              {/* Custom Video Seek Bar Slider */}
              <div className="px-4 py-2 flex items-center gap-3 bg-slate-950/60 border-b border-slate-900">
                <span className="text-xs font-mono text-slate-400 select-none">
                  {formatTime(videoCurrentTime)}
                </span>
                <div className="flex-1 relative flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={videoDuration || 100}
                    step={0.05}
                    value={videoCurrentTime}
                    onChange={(e) => {
                      const newTime = parseFloat(e.target.value)
                      if (videoRef.current) {
                        videoRef.current.currentTime = newTime
                        setVideoCurrentTime(newTime)
                      }
                    }}
                    className="w-full h-1 bg-slate-700/60 rounded-lg appearance-none cursor-pointer accent-orange-500 relative z-10"
                    style={{
                      background: `linear-gradient(to right, #f97316 0%, #f97316 ${(videoCurrentTime / (videoDuration || 1)) * 100}%, rgba(51, 65, 85, 0.6) ${(videoCurrentTime / (videoDuration || 1)) * 100}%, rgba(51, 65, 85, 0.6) 100%)`
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-slate-400 select-none">
                  {formatTime(videoDuration)}
                </span>
              </div>

              {/* Timeline */}
              <div className="px-4 py-2">
                <EventTimeline
                  events={events}
                  duration={selectedVideo?.duration_secs || 0}
                  onSeek={(t) => { if (videoRef.current) videoRef.current.currentTime = t }}
                />
              </div>
            </div>
          ) : (
            <div className="glass-card flex flex-col items-center justify-center" style={{ aspectRatio: '16/9', background: 'rgba(5, 8, 16, 0.6)', border: '1px dashed rgba(0, 212, 255, 0.15)' }}>
              <div className="text-center">
                <Film className="w-12 h-12 mx-auto mb-3 opacity-30" style={{ color: '#00d4ff' }} />
                <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>
                  {selectedVideoId ? 'Video is currently queued or processing…' : 'No Video Loaded'}
                </p>
                <p className="text-xs mt-1.5" style={{ color: '#475569' }}>
                  {selectedVideoId ? 'The AI analysis pipeline is running. Results will appear here shortly.' : 'Please select a completed video from the list or upload a new one.'}
                </p>
              </div>
            </div>
          )}

          {/* Tabs: Events / Timeline */}
          <div className="glass-card overflow-hidden">
            <div className="flex border-b" style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
              {(['events', 'timeline'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-5 py-3 text-xs font-medium capitalize transition-colors"
                  style={{
                    color: activeTab === tab ? '#00d4ff' : '#475569',
                    borderBottom: activeTab === tab ? '2px solid #00d4ff' : '2px solid transparent',
                  }}
                >
                  {tab === 'events' ? <><Target className="w-3.5 h-3.5 inline mr-1" />Events ({events.length})</>
                    : <><Activity className="w-3.5 h-3.5 inline mr-1" />Timeline</>}
                </button>
              ))}
              {selectedVideoId && (
                <button onClick={() => qc.invalidateQueries({ queryKey: ['events', selectedVideoId] })}
                  className="ml-auto px-3">
                  <RefreshCw className="w-3.5 h-3.5" style={{ color: '#334155' }} />
                </button>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto p-3">
              {activeTab === 'events' ? (
                !selectedVideoId ? (
                  <div className="flex items-center justify-center h-32 text-xs" style={{ color: '#334155' }}>
                    Select a processed video
                  </div>
                ) : events.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-xs" style={{ color: '#334155' }}>
                    No events — video may still be processing
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {events.map((ev: any, i: number) => (
                      <motion.div
                        key={ev.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.01 }}
                        className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer hover:bg-white/[0.02]"
                        style={{ border: '1px solid rgba(255,255,255,0.04)' }}
                        onClick={() => {
                          if (videoRef.current && ev.timestamp_secs != null) {
                            videoRef.current.currentTime = ev.timestamp_secs
                            setPlaying(false)
                          }
                        }}
                      >
                        <div className="w-12 text-xs font-mono flex-shrink-0" style={{ color: '#475569' }}>
                          {ev.timestamp_secs != null ? `${ev.timestamp_secs.toFixed(1)}s` : '—'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Class badge with color */}
                            {(() => {
                              const cls = ev.metadata?.class_name || 'person'
                              const clsColor = cls === 'face' ? '#a78bfa'
                                : cls === 'car' ? '#f59e0b'
                                : cls === 'truck' ? '#f97316'
                                : cls === 'bus' ? '#fb923c'
                                : cls === 'motorcycle' ? '#fbbf24'
                                : cls === 'bicycle' ? '#34d399'
                                : '#00d4ff'
                              return (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded capitalize" style={{
                                  background: `${clsColor}18`,
                                  color: clsColor,
                                  border: `1px solid ${clsColor}40`,
                                }}>
                                  {cls}
                                </span>
                              )
                            })()}
                            <span className="text-xs font-medium" style={{ color: '#e2e8f0' }}>
                              {ev.person_name ? `Face Detected: ${ev.person_name}` : ev.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                            </span>
                            <span className={`badge badge-${ev.severity}`}>{ev.severity}</span>
                            {ev.zone_name && (
                              <span className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(0,212,255,0.06)', color: '#00d4ff' }}>
                                {ev.zone_name}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs" style={{ color: '#475569' }}>Track #{ev.track_id}</span>
                            <span className="text-xs font-mono" style={{ color: '#334155' }}>
                              {(ev.confidence * 100).toFixed(0)}% conf
                            </span>
                          </div>
                        </div>
                        <div className="w-16 flex-shrink-0">
                          <div className="threat-meter">
                            <div className="threat-fill" style={{
                              width: `${ev.threat_score * 100}%`,
                              background: ev.threat_score > 0.7 ? '#ef4444' : ev.threat_score > 0.4 ? '#f59e0b' : '#10b981',
                            }} />
                          </div>
                          <div className="text-right text-xs mt-0.5"
                            style={{ color: ev.threat_score > 0.7 ? '#ef4444' : '#00d4ff' }}>
                            {(ev.threat_score * 100).toFixed(0)}%
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )
              ) : (
                /* Timeline view */
                <div className="space-y-1">
                  {timeline.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-xs" style={{ color: '#334155' }}>
                      No timeline data
                    </div>
                  ) : (
                    timeline.map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 border-b text-xs"
                        style={{ borderColor: 'rgba(0,212,255,0.04)' }}>
                        <span className="w-12 font-mono" style={{ color: '#475569' }}>{t.time_secs?.toFixed(1)}s</span>
                        <span className={`badge badge-${t.severity}`}>{t.severity}</span>
                        <span style={{ color: '#94a3b8' }}>{t.event_type?.replace(/_/g, ' ')}</span>
                        <span className="ml-auto" style={{ color: t.threat_score > 0.7 ? '#ef4444' : '#10b981' }}>
                          {(t.threat_score * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
