import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  Camera, Plus, X, Maximize2, Minimize2,
  Wifi, WifiOff, RefreshCw, Grid, LayoutGrid,
  AlertTriangle, Activity, Eye, EyeOff,
} from 'lucide-react'
import { eventsApi, videosApi, detectApi, getApiUrl } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface CameraFeed {
  id: string
  name: string
  streamUrl: string
  location: string
  status: 'live' | 'offline' | 'connecting'
}

const PRESET_CAMERAS: CameraFeed[] = [
  { id: 'cam-1', name: 'Main Entrance', streamUrl: '', location: 'Zone A', status: 'live' },
  { id: 'cam-2', name: 'Parking Lot A', streamUrl: '', location: 'Zone B', status: 'live' },
  { id: 'cam-3', name: 'Server Room', streamUrl: '', location: 'Zone C', status: 'offline' },
  { id: 'cam-4', name: 'Lobby North', streamUrl: '', location: 'Zone A', status: 'live' },
]

type GridLayout = '1x1' | '2x2' | '3x2' | '3x3' | '4x4' | '1+3'

const LAYOUT_CONFIGS: Record<GridLayout, { label: string; cols: number; rows: number }> = {
  '1x1': { label: '1 Camera', cols: 1, rows: 1 },
  '2x2': { label: '4 Camera', cols: 2, rows: 2 },
  '3x2': { label: '6 Camera', cols: 3, rows: 2 },
  '3x3': { label: '9 Camera', cols: 3, rows: 3 },
  '4x4': { label: '16 Camera', cols: 4, rows: 4 },
  '1+3': { label: 'Featured', cols: 4, rows: 2 },
}

function StatusPulse({ status }: { status: CameraFeed['status'] }) {
  const color = status === 'live' ? '#10b981' : status === 'connecting' ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex w-2 h-2">
        {status === 'live' && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ background: color }} />
        )}
        <span className="relative inline-flex rounded-full w-2 h-2" style={{ background: color }} />
      </span>
      <span className="text-xs font-medium uppercase" style={{ color }}>
        {status}
      </span>
    </div>
  )
}

// ── Real-time detection drawing helpers ───────────────────────────────────────
const CLASS_COLORS: Record<string, string> = {
  person: '#00d4ff',
  face: '#a78bfa',
  car: '#f59e0b',
  truck: '#f97316',
  bus: '#fb923c',
  motorcycle: '#fbbf24',
  bicycle: '#34d399',
}
const getDetColor = (className: string, confidence: number) => {
  if (className === 'person' && confidence < 0.5) return '#00d4ff'
  return CLASS_COLORS[className] ?? '#00d4ff'
}

function drawDetections(
  canvas: HTMLCanvasElement,
  detections: any[],
  frameW: number,
  frameH: number,
  inferMs?: number
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const scaleX = canvas.width / frameW
  const scaleY = canvas.height / frameH

  detections.forEach((det: any) => {
    const { x, y, w, h } = det.bbox
    const cx = x * scaleX
    const cy = y * scaleY
    const cw = w * scaleX
    const ch = h * scaleY
    const color = getDetColor(det.class_name, det.confidence)
    const isFace = det.class_name === 'face'

    // Glow box
    ctx.shadowColor = color
    ctx.shadowBlur = isFace ? 14 : 8
    ctx.strokeStyle = color
    ctx.lineWidth = isFace ? 1.5 : 2
    ctx.strokeRect(cx, cy, cw, ch)
    ctx.fillStyle = `${color}12`
    ctx.fillRect(cx, cy, cw, ch)
    ctx.shadowBlur = 0

    // Corner markers for non-face detections
    if (!isFace && cw > 25 && ch > 25) {
      const cl = Math.min(cw, ch) * 0.22
      ctx.strokeStyle = '#ffffffcc'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, cy + cl); ctx.lineTo(cx, cy); ctx.lineTo(cx + cl, cy)
      ctx.moveTo(cx + cw - cl, cy); ctx.lineTo(cx + cw, cy); ctx.lineTo(cx + cw, cy + cl)
      ctx.moveTo(cx, cy + ch - cl); ctx.lineTo(cx, cy + ch); ctx.lineTo(cx + cl, cy + ch)
      ctx.moveTo(cx + cw - cl, cy + ch); ctx.lineTo(cx + cw, cy + ch); ctx.lineTo(cx + cw, cy + ch - cl)
      ctx.stroke()
    }

    // Pulsing feet ellipse for persons
    if (det.class_name === 'person') {
      const pulse = Math.sin(Date.now() / 220)
      ctx.beginPath()
      ctx.ellipse(cx + cw / 2, cy + ch, (cw / 2) * (1 + 0.1 * pulse), 5 * (1 + 0.1 * pulse), 0, 0, Math.PI * 2)
      ctx.strokeStyle = `${color}bb`
      ctx.lineWidth = 1.5
      ctx.fillStyle = `${color}18`
      ctx.fill(); ctx.stroke()
    }

    // Face ring
    if (isFace) {
      const pulse = Math.sin(Date.now() / 280) * 0.5 + 0.5
      const fr = Math.min(cw, ch) / 2 + 3
      ctx.beginPath()
      ctx.arc(cx + cw / 2, cy + ch / 2, fr * (1 + 0.08 * pulse), 0, Math.PI * 2)
      ctx.strokeStyle = `${color}88`
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([])
      const angle = (Date.now() / 550) % (Math.PI * 2)
      ctx.beginPath(); ctx.moveTo(cx + cw / 2, cy + ch / 2)
      ctx.arc(cx + cw / 2, cy + ch / 2, fr, angle - 0.35, angle)
      ctx.closePath(); ctx.fillStyle = `${color}20`; ctx.fill()
    }

    // Label
    const label = `${det.class_name}  ${(det.confidence * 100).toFixed(0)}%`
    ctx.font = isFace ? 'bold 9px monospace' : 'bold 10px monospace'
    const tw = ctx.measureText(label).width + 8
    const labelY = cy > 18 ? cy - 2 : cy + ch + 16
    ctx.fillStyle = `${color}cc`
    ctx.fillRect(cx, labelY - 14, tw, 15)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, cx + 4, labelY - 2)
  })

  // Inference time HUD
  if (inferMs !== undefined) {
    const fps = inferMs > 0 ? Math.round(1000 / inferMs) : 0
    const hudText = `⚡ ${inferMs.toFixed(0)}ms  ${fps}fps`
    ctx.font = '9px monospace'
    ctx.fillStyle = 'rgba(0,212,255,0.6)'
    ctx.fillText(hudText, 6, canvas.height - 6)
  }
}

// ── CameraCell: live video feed + real-time YOLO detection ────────────────────
function CameraCell({
  camera,
  featured = false,
  onMaximize,
  showOverlay,
}: {
  camera: CameraFeed
  featured?: boolean
  onMaximize: () => void
  showOverlay: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)        // detection overlay
  const captureRef = useRef<HTMLCanvasElement>(null)       // offscreen capture
  const localVideoRef = useRef<HTMLVideoElement>(null)     // webcam <video>
  const videoLoopRef = useRef<HTMLVideoElement>(null)      // video-loop <video>
  const detRef = useRef<any[]>([])                         // latest detections
  const captureDimRef = useRef<{w:number,h:number}>({w:640,h:360}) // actual captured frame size
  const animRef = useRef(0)
  const inferRef = useRef<number | undefined>(undefined)
  const detectingRef = useRef(false)
  const [warmingUp, setWarmingUp] = useState(true)

  const isLive = camera.status === 'live'
  const isWebcam = camera.streamUrl === 'webcam'
  const isVideoLoop = camera.streamUrl && (camera.streamUrl.startsWith('/api') || camera.streamUrl.startsWith('http') || camera.streamUrl.endsWith('.mp4'))

  // ── Webcam stream lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    if (!isWebcam || !isLive) return
    let activeStream: MediaStream | null = null

    if (!navigator?.mediaDevices?.getUserMedia) {
      toast.error('Webcam access requires a secure context (HTTPS or localhost). Please check your URL.')
      return
    }

    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } })
      .then(s => {
        activeStream = s
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = s
        }
      })
      .catch(err => {
        let msg = 'Failed to access webcam'
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
          msg = 'Webcam access denied. Please allow camera permissions in your browser.'
        else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')
          msg = 'No webcam found on your system.'
        else if (err.name === 'NotReadableError' || err.name === 'TrackStartError')
          msg = 'Webcam is already in use by another application.'
        toast.error(msg)
      })

    return () => { activeStream?.getTracks().forEach(t => t.stop()) }
  }, [isWebcam, isLive])

  // ── Real-time YOLO detection loop (recursive setTimeout = truly adaptive) ──
  useEffect(() => {
    if (!isLive || !showOverlay) return
    let stopped = false
    let firstSuccess = false
    let timeoutId: ReturnType<typeof setTimeout>

    const runDetect = async () => {
      if (stopped) return

      if (!detectingRef.current) {
        detectingRef.current = true
        try {
          const videoEl = isWebcam ? localVideoRef.current : videoLoopRef.current
          const capture = captureRef.current
          if (capture && videoEl) {
            const vw = videoEl.videoWidth || 640
            const vh = videoEl.videoHeight || 360

            if (vw > 0 && vh > 0) {
              // Capture at 640px — backend runs YOLO at 640 natively, no wasted resize
              const captureW = Math.min(vw, 640)
              const captureH = Math.round((captureW / vw) * vh)
              capture.width = captureW
              capture.height = captureH
              captureDimRef.current = { w: captureW, h: captureH }

              const ctx2d = capture.getContext('2d')
              if (ctx2d) {
                ctx2d.drawImage(videoEl, 0, 0, captureW, captureH)
                const blob: Blob | null = await new Promise(res => capture.toBlob(res, 'image/jpeg', 0.80))

                if (blob && !stopped) {
                  const result = await detectApi.frame(blob)
                  if (!stopped) {
                    detRef.current = result.detections || []
                    inferRef.current = result.inference_ms
                    if (!firstSuccess) { firstSuccess = true; setWarmingUp(false) }
                  }
                }
              }
            }
          }
        } catch {
          // ignore transient network errors
        }
        detectingRef.current = false
      }

      // Schedule next run — adapt to last inference time, 500-1500ms range
      const nextMs = Math.max(500, Math.min(1500, (inferRef.current ?? 500) * 1.5))
      if (!stopped) timeoutId = setTimeout(runDetect, nextMs)
    }

    timeoutId = setTimeout(runDetect, 100) // start quickly
    return () => { stopped = true; clearTimeout(timeoutId) }
  }, [isLive, showOverlay, isWebcam])

  // ── Overlay render loop ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderLoop = () => {
      if (showOverlay && isLive) {
        // Use captured frame dimensions (not video element native size) for correct bbox scaling
        const { w, h } = captureDimRef.current
        drawDetections(canvas, detRef.current, w, h, inferRef.current)
      } else {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      animRef.current = requestAnimationFrame(renderLoop)
    }

    renderLoop()
    return () => cancelAnimationFrame(animRef.current)
  }, [showOverlay, isLive, isWebcam])

  return (
    <motion.div
      layout
      className="relative rounded-xl overflow-hidden flex flex-col"
      style={{
        background: '#050810',
        border: `1px solid ${isLive ? 'rgba(0,212,255,0.15)' : 'rgba(239,68,68,0.15)'}`,
        minHeight: featured ? 400 : 0,
      }}
    >
      {/* Camera header */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ background: 'rgba(0,0,0,0.5)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2">
          <Camera className="w-3.5 h-3.5" style={{ color: isLive ? '#00d4ff' : '#ef4444' }} />
          <span className="text-xs font-medium" style={{ color: '#e2e8f0' }}>{camera.name}</span>
          <span className="text-xs" style={{ color: '#334155' }}>· {camera.location}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPulse status={camera.status} />
          <button onClick={onMaximize} className="p-1 rounded hover:bg-white/10">
            <Maximize2 className="w-3 h-3" style={{ color: '#475569' }} />
          </button>
        </div>
      </div>

      {/* Feed area */}
      <div className="relative flex-1" style={{ aspectRatio: '16/9' }}>
        {isLive ? (
          <>
            {/* Webcam feed */}
            {isWebcam && (
              <video ref={localVideoRef} autoPlay muted playsInline
                className="absolute inset-0 w-full h-full object-cover" />
            )}

            {/* Video loop feed */}
            {isVideoLoop && (
              <video
                ref={videoLoopRef}
                src={camera.streamUrl.startsWith('/') ? getApiUrl(camera.streamUrl) : camera.streamUrl}
                autoPlay muted loop playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}

            {/* Simulated/no-stream placeholder */}
            {!isWebcam && !isVideoLoop && (
              <div className="absolute inset-0 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #050810 0%, #0a1020 100%)' }}>
                <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern id={`grid-${camera.id}`} width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#00d4ff" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill={`url(#grid-${camera.id})`} />
                </svg>
                <div className="text-center z-10">
                  <Camera className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: '#00d4ff' }} />
                  <p className="text-xs" style={{ color: '#1e293b' }}>Simulated Feed</p>
                  <p className="text-xs mt-0.5" style={{ color: '#0f172a' }}>Add a webcam or video source</p>
                </div>
              </div>
            )}

            {/* Offscreen capture canvas (hidden) */}
            <canvas ref={captureRef} style={{ display: 'none' }} />

            {/* Detection overlay canvas */}
            <canvas
              ref={canvasRef}
              width={640} height={360}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            />

            {/* REC badge */}
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded"
              style={{ background: 'rgba(0,0,0,0.6)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-bold" style={{ color: '#ef4444' }}>REC</span>
            </div>

            {/* AI status badge */}
            {showOverlay && (isWebcam || isVideoLoop) && (
              <div className="absolute top-2 right-10 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold"
                style={{
                  background: warmingUp ? 'rgba(245,158,11,0.12)' : 'rgba(0,212,255,0.12)',
                  color: warmingUp ? '#f59e0b' : '#00d4ff',
                  border: `1px solid ${warmingUp ? 'rgba(245,158,11,0.3)' : 'rgba(0,212,255,0.25)'}`,
                }}>
                {warmingUp ? (
                  <><span className="animate-spin inline-block mr-0.5">⟳</span> Warming AI...</>
                ) : (
                  <>⚡ AI LIVE</>
                )}
              </div>
            )}

            {/* Timestamp */}
            <div className="absolute bottom-2 right-2 font-mono text-xs"
              style={{ color: 'rgba(0,212,255,0.4)' }}>
              {new Date().toLocaleTimeString()}
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: '#020408' }}>
            <WifiOff className="w-8 h-8 mb-2 opacity-30" style={{ color: '#ef4444' }} />
            <p className="text-xs font-medium" style={{ color: '#475569' }}>Feed Offline</p>
            <p className="text-xs mt-1" style={{ color: '#1e293b' }}>Check connection</p>
          </div>
        )}
      </div>
    </motion.div>
  )
}


function AddCameraModal({ onAdd, onClose, videos, token }: {
  onAdd: (cam: CameraFeed) => void
  onClose: () => void
  videos: any[]
  token: string | null
}) {
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState<'simulated' | 'webcam' | 'video' | 'custom'>('simulated')
  const [selectedVideoId, setSelectedVideoId] = useState('')
  const [url, setUrl] = useState('')
  const [location, setLocation] = useState('')

  const handle = () => {
    if (!name.trim()) { toast.error('Camera name required'); return }
    
    let streamUrl = ''
    if (sourceType === 'webcam') {
      streamUrl = 'webcam'
    } else if (sourceType === 'video') {
      if (!selectedVideoId) {
        toast.error('Please select an uploaded video')
        return
      }
      streamUrl = `/api/v1/videos/${selectedVideoId}/stream${token ? `?token=${token}` : ''}`
    } else if (sourceType === 'custom') {
      if (!url.trim()) {
        toast.error('Stream URL required')
        return
      }
      streamUrl = url.trim()
    }

    onAdd({
      id: `cam-${Date.now()}`,
      name: name.trim(),
      streamUrl: streamUrl,
      location: location.trim() || 'Unknown',
      status: 'connecting',
    })
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-96 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#e2e8f0' }}>
          <Camera className="w-4 h-4 inline mr-2" style={{ color: '#00d4ff' }} />
          Add Camera Feed
        </h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Camera Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="asip-input w-full" placeholder="e.g. Main Entrance" />
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Source Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(['simulated', 'webcam', 'video', 'custom'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSourceType(type)}
                  className="px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left capitalize"
                  style={{
                    background: sourceType === type ? 'rgba(0, 212, 255, 0.1)' : 'rgba(255,255,255,0.02)',
                    borderColor: sourceType === type ? '#00d4ff' : 'rgba(255,255,255,0.05)',
                    color: sourceType === type ? '#00d4ff' : '#94a3b8',
                  }}
                >
                  {type === 'simulated' ? 'Simulated Grid' : type === 'webcam' ? 'PC Webcam' : type === 'video' ? 'Video Loop' : 'Custom URL'}
                </button>
              ))}
            </div>
          </div>

          {sourceType === 'video' && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Select Video Source</label>
              <select
                value={selectedVideoId}
                onChange={e => setSelectedVideoId(e.target.value)}
                className="asip-input w-full bg-[#050810]"
                style={{ color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <option value="" disabled style={{ background: '#050810' }}>-- Select Video --</option>
                {videos.map((vid: any) => (
                  <option key={vid.id} value={vid.id} style={{ background: '#050810' }}>
                    {vid.original_name || vid.filename} ({vid.resolution})
                  </option>
                ))}
              </select>
            </div>
          )}

          {sourceType === 'custom' && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Stream URL (RTSP / HLS / MP4)</label>
              <input value={url} onChange={e => setUrl(e.target.value)}
                className="asip-input w-full" placeholder="rtsp://192.168.1.x:554/stream" />
            </div>
          )}

          <div>
            <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Location / Zone</label>
            <input value={location} onChange={e => setLocation(e.target.value)}
              className="asip-input w-full" placeholder="e.g. Zone A" />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>
            Cancel
          </button>
          <button onClick={handle} className="flex-1 btn-glow py-2 text-sm">
            Add Camera
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function LiveCameraGrid() {
  const [cameras, setCameras] = useState<CameraFeed[]>(() => {
    const saved = localStorage.getItem('asip_grid_cameras')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((c: any) => ({
            ...c,
            status: c.streamUrl === 'webcam' ? 'live' : c.status
          }))
        }
      } catch (e) {
        console.error('Failed to parse saved cameras', e)
      }
    }
    return PRESET_CAMERAS
  })
  const [layout, setLayout] = useState<GridLayout>(() => {
    return (localStorage.getItem('asip_grid_layout') as GridLayout) || '2x2'
  })
  const [showOverlay, setShowOverlay] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  const [clock, setClock] = useState(new Date().toLocaleTimeString())

  const token = useAuthStore(state => state.token)

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    localStorage.setItem('asip_grid_cameras', JSON.stringify(cameras))
  }, [cameras])

  useEffect(() => {
    localStorage.setItem('asip_grid_layout', layout)
  }, [layout])

  const { data: recentEvents = [] } = useQuery({
    queryKey: ['camera-events'],
    queryFn: () => eventsApi.list({ per_page: 50 }),
    select: d => d.items,
    refetchInterval: 5000,
  })

  const { data: videos = [] } = useQuery({
    queryKey: ['videos'],
    queryFn: () => videosApi.list(),
  })

  const validVideos = videos.filter((v: any) => v.status !== 'failed')

  const handleAddCamera = (cam: CameraFeed) => {
    setCameras(prev => {
      const next = [...prev, cam]
      const capacity = {
        '1x1': 1,
        '2x2': 4,
        '3x2': 6,
        '3x3': 9,
        '4x4': 16,
        '1+3': 4,
      }[layout]
      if (next.length > capacity) {
        if (layout === '1x1') setLayout('2x2')
        else if (layout === '2x2') setLayout('3x2')
        else if (layout === '3x2') setLayout('3x3')
        else if (layout === '3x3') setLayout('4x4')
      } else {
        const pageOfNewCam = Math.floor((next.length - 1) / capacity)
        setCurrentPage(pageOfNewCam)
      }
      return next
    })
    // simulate connecting → live
    setTimeout(() => {
      setCameras(prev => prev.map(c => c.id === cam.id ? { ...c, status: 'live' } : c))
    }, 2000)
  }

  const removeCamera = (id: string) => setCameras(prev => prev.filter(c => c.id !== id))

  const liveCount = cameras.filter(c => c.status === 'live').length
  const offlineCount = cameras.filter(c => c.status === 'offline').length
  const alertCount = recentEvents.filter((e: any) => e.severity === 'high' || e.severity === 'critical').length

  const [currentPage, setCurrentPage] = useState(0)

  const pageSize = {
    '1x1': 1,
    '2x2': 4,
    '3x2': 6,
    '3x3': 9,
    '4x4': 16,
    '1+3': 4,
  }[layout]

  const totalPages = Math.ceil(cameras.length / pageSize)

  useEffect(() => {
    setCurrentPage(0)
  }, [layout])

  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1)
    }
  }, [cameras.length, pageSize, totalPages, currentPage])

  const gridCols = {
    '1x1': 'grid-cols-1',
    '2x2': 'grid-cols-2',
    '3x2': 'grid-cols-3',
    '3x3': 'grid-cols-3',
    '4x4': 'grid-cols-4',
    '1+3': 'grid-cols-4',
  }[layout]

  const startIndex = currentPage * pageSize
  const endIndex = startIndex + pageSize
  const displayedCams = cameras.slice(startIndex, endIndex)

  const maximizedCam = cameras.find(c => c.id === maximizedId)

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Live Camera Grid</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Multi-channel surveillance monitoring with AI detection overlays
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status pills */}
          <div className="flex gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
              {liveCount} Live
            </span>
            {offlineCount > 0 && (
              <span className="px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                {offlineCount} Offline
              </span>
            )}
            {alertCount > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                <AlertTriangle className="w-3 h-3" />
                {alertCount} Alerts
              </span>
            )}
          </div>

          {/* Layout switcher */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(0,212,255,0.15)' }}>
            {(Object.keys(LAYOUT_CONFIGS) as GridLayout[]).map(l => (
              <button
                key={l}
                onClick={() => setLayout(l)}
                title={LAYOUT_CONFIGS[l].label}
                className="px-3 py-1.5 text-xs"
                style={{
                  background: layout === l ? 'rgba(0,212,255,0.15)' : 'transparent',
                  color: layout === l ? '#00d4ff' : '#475569',
                }}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg animate-fade-in" style={{ border: '1px solid rgba(0,212,255,0.15)', background: 'rgba(255,255,255,0.02)' }}>
              <button
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                className="px-2 py-0.5 text-xs rounded hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent font-bold transition-all"
                style={{ color: '#00d4ff' }}
                title="Previous Page"
              >
                &larr;
              </button>
              <span className="text-[11px] font-mono text-slate-400 px-1 select-none">
                {currentPage + 1}/{totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages - 1}
                onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                className="px-2 py-0.5 text-xs rounded hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent font-bold transition-all"
                style={{ color: '#00d4ff' }}
                title="Next Page"
              >
                &rarr;
              </button>
            </div>
          )}

          {/* Overlay toggle */}
          <button
            onClick={() => setShowOverlay(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{
              background: showOverlay ? 'rgba(0,212,255,0.1)' : 'transparent',
              color: showOverlay ? '#00d4ff' : '#475569',
              border: '1px solid rgba(0,212,255,0.2)',
            }}
          >
            {showOverlay ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            AI Overlay
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm btn-glow"
          >
            <Plus className="w-4 h-4" /> Add Camera
          </button>
        </div>
      </div>

      {/* Live stats bar */}
      <div className="glass-card px-4 py-2 flex items-center gap-6 text-xs flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" style={{ color: '#00d4ff' }} />
          <span style={{ color: '#475569' }}>System Time:</span>
          <span className="font-mono" style={{ color: '#00d4ff' }}>{clock}</span>
        </div>
        <div className="h-3 w-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" style={{ color: '#475569' }} />
          <span style={{ color: '#475569' }}>Total Feeds:</span>
          <span className="font-mono" style={{ color: '#94a3b8' }}>{cameras.length}</span>
        </div>
        <div className="h-3 w-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" style={{ color: '#475569' }} />
          <span style={{ color: '#475569' }}>Recent Detections:</span>
          <span className="font-mono" style={{ color: '#94a3b8' }}>{recentEvents.length}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span style={{ color: '#10b981' }}>Recording all feeds</span>
        </div>
      </div>

      {/* Camera Grid Container */}
      <div className="flex-1 overflow-y-auto pr-1 min-h-0">
        <div className={`grid ${gridCols} gap-4`}
          style={{ gridAutoRows: (layout === '3x2' || layout === '3x3' || layout === '4x4') ? '1fr' : undefined }}>
        {displayedCams.map((cam, i) => (
          <div key={cam.id} className="relative group"
            style={{ gridColumn: layout === '1+3' && i === 0 ? 'span 2' : undefined }}>
            <CameraCell
              camera={cam}
              featured={layout === '1+3' && i === 0}
              onMaximize={() => setMaximizedId(cam.id)}
              showOverlay={showOverlay}
            />
            {/* Remove button on hover */}
            <button
              onClick={() => removeCamera(cam.id)}
              className="absolute top-10 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
              style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Empty slots */}
        {Array.from({ length: Math.max(0, pageSize - displayedCams.length) }).map((_, i) => (
          <div key={`empty-${i}`}
            className="rounded-xl flex items-center justify-center cursor-pointer transition-colors"
            style={{
              border: '1px dashed rgba(0,212,255,0.12)',
              background: 'rgba(0,212,255,0.02)',
              aspectRatio: '16/9',
            }}
            onClick={() => setShowAddModal(true)}
          >
            <div className="text-center">
              <Plus className="w-6 h-6 mx-auto mb-1 opacity-30" style={{ color: '#00d4ff' }} />
              <p className="text-xs" style={{ color: '#1e293b' }}>Add camera</p>
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* Maximized view */}
      <AnimatePresence>
        {maximizedCam && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col p-4"
            style={{ background: 'rgba(2,4,8,0.97)', backdropFilter: 'blur(12px)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5" style={{ color: '#00d4ff' }} />
                <span className="text-lg font-bold" style={{ color: '#e2e8f0' }}>{maximizedCam.name}</span>
                <StatusPulse status={maximizedCam.status} />
              </div>
              <button
                onClick={() => setMaximizedId(null)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <Minimize2 className="w-4 h-4" /> Close
              </button>
            </div>
            <div className="flex-1 rounded-xl overflow-hidden">
              <CameraCell
                camera={maximizedCam}
                featured
                onMaximize={() => {}}
                showOverlay={showOverlay}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add camera modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddCameraModal
            onAdd={handleAddCamera}
            onClose={() => setShowAddModal(false)}
            videos={validVideos}
            token={token}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
