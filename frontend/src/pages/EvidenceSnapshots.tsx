import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Camera, Download, Trash2, RefreshCw, Clock,
  Image, Film, ZoomIn, CheckCircle2,
} from 'lucide-react'
import { reportsApi, videosApi } from '@/api/client'
import { format } from 'date-fns'
import toast from 'react-hot-toast'


function AuthImage({ filename, className, alt }: {
  filename: string
  className?: string
  alt?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    let objectUrl: string | null = null

    async function load() {
      try {
        setLoading(true)
        const res = await reportsApi.downloadSnapshot(filename)
        objectUrl = URL.createObjectURL(new Blob([res.data], { type: 'image/jpeg' }))
        if (isMounted) {
          setSrc(objectUrl)
        }
      } catch (e) {
        console.error("Failed to load authenticated snapshot image", e)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      isMounted = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [filename])

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-[#030609] ${className}`}>
        <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-[#030609] ${className}`}>
        <Image className="w-6 h-6 text-red-500 opacity-50" />
      </div>
    )
  }

  return <img src={src} className={className} alt={alt} />
}

function SnapshotCard({ snap, onDownload, onDelete }: {
  snap: any
  onDownload: () => void
  onDelete: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      className="glass-card overflow-hidden group"
    >
      {/* Thumbnail area */}
      <div
        className="relative flex items-center justify-center cursor-pointer"
        style={{ aspectRatio: '16/9', background: '#030609' }}
        onClick={onDownload}
      >
        <AuthImage
          filename={snap.filename}
          className="w-full h-full object-cover"
          alt={snap.filename}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.5)' }}>
          <ZoomIn className="w-8 h-8" style={{ color: '#00d4ff' }} />
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-mono truncate" style={{ color: '#94a3b8' }}>
              {snap.filename}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Clock className="w-3 h-3 flex-shrink-0" style={{ color: '#334155' }} />
              <span className="text-xs" style={{ color: '#475569' }}>
                {format(new Date(snap.captured_at), 'MMM dd HH:mm:ss')}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: '#1e293b' }}>
              {Math.round(snap.size_bytes / 1024)} KB
            </p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={onDownload}
              className="p-1.5 rounded-lg"
              style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff' }}
              title="Download"
            >
              <Download className="w-3 h-3" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
              title="Delete"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function CapturePanel({ videos, selectedVideoId, onSelect }: {
  videos: any[]
  selectedVideoId: string | null
  onSelect: (id: string) => void
}) {
  const [timestamp, setTimestamp] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const qc = useQueryClient()

  const capture = async () => {
    if (!selectedVideoId) { toast.error('Select a video first'); return }
    setCapturing(true)
    try {
      await reportsApi.captureSnapshot(selectedVideoId, timestamp)
      toast.success(`Snapshot captured at ${timestamp}s`)
      qc.invalidateQueries({ queryKey: ['snapshots'] })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Capture failed')
    } finally {
      setCapturing(false)
    }
  }

  const selectedVideo = videos.find((v: any) => v.id === selectedVideoId)

  return (
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-sm font-semibold" style={{ color: '#94a3b8' }}>
        <Camera className="w-4 h-4 inline mr-2" style={{ color: '#00d4ff' }} />
        Capture Evidence Frame
      </h3>

      {/* Video selector */}
      <div>
        <label className="text-xs mb-1.5 block" style={{ color: '#475569' }}>Select Video</label>
        <select
          className="asip-input text-sm w-full"
          value={selectedVideoId || ''}
          onChange={e => onSelect(e.target.value)}
        >
          <option value="">— Choose a video —</option>
          {videos.filter((v: any) => v.status === 'completed').map((v: any) => (
            <option key={v.id} value={v.id}>
              {v.original_name || v.filename}
            </option>
          ))}
        </select>
      </div>

      {/* Timestamp */}
      <div>
        <label className="text-xs mb-1.5 block" style={{ color: '#475569' }}>
          Timestamp (seconds)
          {selectedVideo?.duration_secs && (
            <span className="ml-2 font-mono" style={{ color: '#334155' }}>
              / {selectedVideo.duration_secs.toFixed(0)}s total
            </span>
          )}
        </label>
        <div className="flex items-center gap-3">
          {selectedVideo?.duration_secs && (
            <input
              type="range"
              min="0"
              max={selectedVideo.duration_secs}
              step="0.5"
              value={timestamp}
              onChange={e => setTimestamp(Number(e.target.value))}
              className="flex-1"
            />
          )}
          <input
            type="number"
            min="0"
            step="0.5"
            value={timestamp}
            onChange={e => setTimestamp(Number(e.target.value))}
            className="asip-input text-sm w-24 font-mono"
            placeholder="0.0"
          />
          <span className="text-xs" style={{ color: '#334155' }}>s</span>
        </div>
      </div>

      <button
        onClick={capture}
        disabled={!selectedVideoId || capturing}
        className="w-full btn-glow py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {capturing ? (
          <><div className="spinner w-4 h-4" /> Capturing…</>
        ) : (
          <><Camera className="w-4 h-4" /> Capture Frame</>
        )}
      </button>

      <div className="text-xs p-3 rounded-lg" style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.08)' }}>
        <p style={{ color: '#475569' }}>Evidence snapshots are saved as JPEG files and can be attached to incident reports.</p>
      </div>
    </div>
  )
}

export default function EvidenceSnapshots() {
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [filterVideoId, setFilterVideoId] = useState<string | undefined>()
  const qc = useQueryClient()

  const { data: videos = [] } = useQuery({
    queryKey: ['videos'],
    queryFn: () => videosApi.list(),
  })

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['snapshots', filterVideoId],
    queryFn: () => reportsApi.listSnapshots(filterVideoId),
    refetchInterval: 10000,
  })

  const deleteMutation = useMutation({
    mutationFn: (snapName: string) => reportsApi.deleteSnapshot(snapName),
    onSuccess: () => {
      toast.success('Snapshot deleted successfully')
      qc.invalidateQueries({ queryKey: ['snapshots'] })
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.detail || 'Deletion failed')
    }
  })

  const handleDownload = async (snap: any) => {
    try {
      const res = await reportsApi.downloadSnapshot(snap.filename)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'image/jpeg' }))
      const a = document.createElement('a')
      a.href = url
      a.download = snap.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Try direct link
      window.open(snap.download_url, '_blank')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Evidence Snapshots</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Capture, store, and export video frame evidence
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['snapshots'] })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Left: capture panel */}
        <div className="space-y-4">
          <CapturePanel
            videos={videos}
            selectedVideoId={selectedVideoId}
            onSelect={setSelectedVideoId}
          />

          {/* Stats */}
          <div className="glass-card p-4">
            <h4 className="text-xs font-semibold mb-3" style={{ color: '#475569' }}>EVIDENCE LIBRARY</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span style={{ color: '#64748b' }}>Total Snapshots</span>
                <span className="font-mono font-bold" style={{ color: '#00d4ff' }}>
                  {snapshots.length}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: '#64748b' }}>Total Size</span>
                <span className="font-mono" style={{ color: '#94a3b8' }}>
                  {(snapshots.reduce((s: number, sn: any) => s + (sn.size_bytes || 0), 0) / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
            </div>
          </div>

          {/* Filter by video */}
          <div className="glass-card p-4">
            <h4 className="text-xs font-semibold mb-3" style={{ color: '#475569' }}>FILTER</h4>
            <select
              className="asip-input text-sm w-full"
              value={filterVideoId || ''}
              onChange={e => setFilterVideoId(e.target.value || undefined)}
            >
              <option value="">All Videos</option>
              {videos.filter((v: any) => v.status === 'completed').map((v: any) => (
                <option key={v.id} value={v.id}>
                  {v.original_name || v.filename}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: snapshot gallery */}
        <div className="col-span-2">
          {isLoading ? (
            <div className="flex justify-center py-16"><div className="spinner" /></div>
          ) : snapshots.length === 0 ? (
            <div className="glass-card p-16 text-center">
              <Image className="w-14 h-14 mx-auto mb-4 opacity-10" style={{ color: '#00d4ff' }} />
              <p className="text-sm font-medium" style={{ color: '#64748b' }}>No snapshots captured yet</p>
              <p className="text-sm mt-1" style={{ color: '#334155' }}>
                Use the capture panel to extract evidence frames from processed videos
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {snapshots.map((snap: any) => (
                <SnapshotCard
                  key={snap.filename}
                  snap={snap}
                  onDownload={() => handleDownload(snap)}
                  onDelete={() => {
                    if (window.confirm("Are you sure you want to delete this snapshot?")) {
                      deleteMutation.mutate(snap.filename)
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
