import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Scan, User, Users, Search, CheckCircle2,
  AlertTriangle, Camera, Fingerprint, Plus, RefreshCw, Trash2,
} from 'lucide-react'
import { personsApi, api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

const facesApi = {
  list: (params?: any) => api.get('/faces/', { params }).then(r => r.data),
  register: (personId: string, photo: File) => {
    const form = new FormData()
    form.append('person_id', personId)
    form.append('photo', photo)
    return api.post('/faces/register', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  search: (photo: File, threshold?: number) => {
    const form = new FormData()
    form.append('photo', photo)
    if (threshold) form.append('threshold', String(threshold))
    return api.post('/faces/search', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  verify: (faceId: string, photo: File) => {
    const form = new FormData()
    form.append('photo', photo)
    return api.post(`/faces/${faceId}/verify`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
}

function RiskBadge({ risk }: { risk: string }) {
  const colors: Record<string, string> = {
    unknown: '#64748b', low: '#10b981', medium: '#f59e0b',
    high: '#ef4444', critical: '#dc2626',
  }
  const color = colors[risk] || '#64748b'
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
      {risk.toUpperCase()}
    </span>
  )
}

function PersonAvatar({ name, registered }: { name?: string, registered: boolean }) {
  return (
    <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold flex-shrink-0"
      style={{
        background: 'linear-gradient(135deg, rgba(0,212,255,0.12), rgba(124,58,237,0.12))',
        border: registered ? '2px solid rgba(0,212,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
        color: '#00d4ff',
      }}>
      {name ? name[0].toUpperCase() : <User className="w-7 h-7" />}
      {registered && (
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: '#10b981', border: '2px solid #090d1a' }}>
          <Fingerprint className="w-2.5 h-2.5 text-white" />
        </div>
      )}
    </div>
  )
}

function RegisterFaceModal({ person, onClose }: { person: any, onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => facesApi.register(person.id, file!),
    onSuccess: () => {
      toast.success('Face registered successfully')
      qc.invalidateQueries({ queryKey: ['persons'] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Registration failed'),
  })

  const handleFile = (f: File) => {
    setFile(f)
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(f)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-96"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#e2e8f0' }}>
          Register Face — {person.name || 'Unknown'}
        </h3>

        <div
          className="rounded-xl p-6 text-center cursor-pointer mb-4 transition-colors"
          style={{
            border: '2px dashed rgba(0,212,255,0.2)',
            background: 'rgba(0,212,255,0.03)',
          }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {preview ? (
            <img src={preview} alt="Preview" className="w-32 h-32 mx-auto rounded-xl object-cover" />
          ) : (
            <>
              <Camera className="w-8 h-8 mx-auto mb-2" style={{ color: '#00d4ff', opacity: 0.5 }} />
              <p className="text-xs" style={{ color: '#475569' }}>Click to upload face photo</p>
              <p className="text-xs mt-1" style={{ color: '#334155' }}>JPEG, PNG — clear frontal face</p>
            </>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!file || mutation.isPending}
            className="flex-1 btn-glow py-2 text-sm disabled:opacity-40"
          >
            {mutation.isPending ? 'Registering…' : 'Register Face'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    setFile(f)
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(f)
  }

  const handleSearch = async () => {
    if (!file) return
    setSearching(true)
    try {
      const res = await facesApi.search(file, 0.6)
      setResults(res.matches || [])
      if ((res.matches || []).length === 0) toast('No matches found', { icon: '🔍' })
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-[480px]"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#e2e8f0' }}>
          <Scan className="w-4 h-4 inline mr-2" style={{ color: '#00d4ff' }} />
          Face Recognition Search
        </h3>

        <div
          className="rounded-xl p-6 text-center cursor-pointer mb-4"
          style={{ border: '2px dashed rgba(0,212,255,0.2)', background: 'rgba(0,212,255,0.03)' }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {preview ? (
            <img src={preview} alt="Query" className="w-28 h-28 mx-auto rounded-xl object-cover" />
          ) : (
            <>
              <Scan className="w-8 h-8 mx-auto mb-2" style={{ color: '#00d4ff', opacity: 0.5 }} />
              <p className="text-xs" style={{ color: '#475569' }}>Upload photo to search</p>
            </>
          )}
        </div>

        <button onClick={handleSearch} disabled={!file || searching}
          className="w-full btn-glow py-2 text-sm mb-4 disabled:opacity-40">
          {searching ? 'Searching…' : 'Search Registry'}
        </button>

        {results.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: '#64748b' }}>{results.length} match(es)</p>
            {results.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg"
                style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.1)' }}>
                <PersonAvatar name={r.person_name} registered />
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: '#e2e8f0' }}>
                    {r.person_name || 'Unknown'}
                  </p>
                  <p className="text-xs" style={{ color: '#475569' }}>Confidence: {(r.confidence * 100).toFixed(1)}%</p>
                </div>
                <div className="text-right">
                  <div className="w-16 h-1.5 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div style={{ width: `${r.confidence * 100}%`, height: '100%', background: '#10b981' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} className="w-full mt-3 py-2 rounded-lg text-sm"
          style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>
          Close
        </button>
      </motion.div>
    </motion.div>
  )
}

function AddPersonModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [riskLevel, setRiskLevel] = useState('unknown')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setLoading(true)
    try {
      await personsApi.create({
        name: name.trim(),
        alias: alias.trim() || undefined,
        risk_level: riskLevel,
        notes: notes.trim() || undefined,
      })
      toast.success('Person created successfully')
      qc.invalidateQueries({ queryKey: ['persons'] })
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create person')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-96"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#e2e8f0' }}>
          Add Person Profile
        </h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="asip-input w-full" placeholder="e.g. John Doe" />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Alias</label>
            <input value={alias} onChange={e => setAlias(e.target.value)}
              className="asip-input w-full" placeholder="e.g. JD / Subject A" />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Risk Level</label>
            <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)}
              className="asip-input w-full bg-[#050810]" style={{ color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)' }}>
              <option value="unknown" style={{ background: '#050810' }}>Unknown</option>
              <option value="low" style={{ background: '#050810' }}>Low</option>
              <option value="medium" style={{ background: '#050810' }}>Medium</option>
              <option value="high" style={{ background: '#050810' }}>High</option>
              <option value="critical" style={{ background: '#050810' }}>Critical</option>
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: '#64748b' }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="asip-input w-full h-20 resize-none py-1.5" placeholder="e.g. Operator / VIP visitor..." />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={loading} className="flex-1 btn-glow py-2 text-sm">
            {loading ? 'Creating...' : 'Create Profile'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function FaceRegistry() {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState('all')
  const [registerTarget, setRegisterTarget] = useState<any>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showAddPerson, setShowAddPerson] = useState(false)
  const qc = useQueryClient()

  const deletePersonMutation = useMutation({
    mutationFn: (personId: string) => personsApi.delete(personId),
    onSuccess: () => {
      toast.success('Person profile deleted successfully')
      qc.invalidateQueries({ queryKey: ['persons'] })
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.detail || 'Deletion failed')
    }
  })

  const { data: persons = [], isLoading } = useQuery({
    queryKey: ['persons', riskFilter],
    queryFn: () => personsApi.list({ risk_level: riskFilter === 'all' ? undefined : riskFilter, limit: 200 }),
  })

  const deleteFaceMutation = useMutation({
    mutationFn: (personId: string) => personsApi.deleteFace(personId),
    onSuccess: () => {
      toast.success('Face registration deleted successfully')
      qc.invalidateQueries({ queryKey: ['persons'] })
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.detail || 'Deletion failed')
    }
  })

  const filtered = persons.filter((p: any) =>
    !search || (p.name || '').toLowerCase().includes(search.toLowerCase())
  )

  const registeredCount = persons.filter((p: any) => p.is_registered).length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Face Registry</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            {registeredCount} of {persons.length} persons with face biometrics
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddPerson(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm btn-glow"
          >
            <Plus className="w-4 h-4" /> Add Person
          </button>
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
            style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            <Scan className="w-4 h-4" /> Search Face
          </button>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['persons'] })}
            className="p-2 rounded-lg"
            style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Persons', value: persons.length, color: '#00d4ff', icon: Users },
          { label: 'Face Registered', value: registeredCount, color: '#10b981', icon: Fingerprint },
          { label: 'High Risk', value: persons.filter((p: any) => p.risk_level === 'high' || p.risk_level === 'critical').length, color: '#ef4444', icon: AlertTriangle },
          { label: 'Unregistered', value: persons.length - registeredCount, color: '#f59e0b', icon: User },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="glass-card p-4 flex items-center gap-3"
            style={{ borderColor: `${color}20` }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <div>
              <p className="text-xl font-bold" style={{ color }}>{value}</p>
              <p className="text-xs" style={{ color: '#475569' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#475569' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="asip-input pl-9" placeholder="Search persons…" />
        </div>
        <select className="asip-input text-xs py-1.5 w-40" value={riskFilter}
          onChange={e => setRiskFilter(e.target.value)}>
          <option value="all">All Risk</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {/* Person grid */}
      {isLoading ? (
        <div className="flex justify-center py-16"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <User className="w-12 h-12 mx-auto mb-3 opacity-10" style={{ color: '#00d4ff' }} />
          <p className="text-sm" style={{ color: '#334155' }}>No persons found</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((person: any) => (
            <motion.div
              key={person.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -2 }}
              className="glass-card p-4"
              style={{ borderColor: person.is_registered ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.05)' }}
            >
              <div className="flex items-start gap-3 justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <PersonAvatar name={person.name} registered={person.is_registered} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>
                      {person.name || `Unknown #${person.id.slice(0, 6)}`}
                    </p>
                    {person.alias && (
                      <p className="text-xs truncate" style={{ color: '#475569' }}>aka {person.alias}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <RiskBadge risk={person.risk_level} />
                      {person.is_registered && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: '#10b981' }}>
                          <CheckCircle2 className="w-3 h-3" /> Biometric
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {user && ['admin', 'analyst'].includes(user.role) && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to delete the person profile "${person.name}" entirely? This will also remove any registered face biometrics.`)) {
                        deletePersonMutation.mutate(person.id)
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title="Delete person profile"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {person.notes && (
                <p className="text-xs mt-2 line-clamp-2" style={{ color: '#475569' }}>{person.notes}</p>
              )}

              <div className="flex gap-2 mt-3">
                {!person.is_registered && (
                  <button
                    onClick={() => setRegisterTarget(person)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs"
                    style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.2)' }}
                  >
                    <Camera className="w-3 h-3" /> Register Face
                  </button>
                )}
                {person.is_registered && (
                  <>
                    <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs"
                      style={{ background: 'rgba(16,185,129,0.06)', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)' }}>
                      <Fingerprint className="w-3 h-3" /> Face Active
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to delete face registration for ${person.name}?`)) {
                          deleteFaceMutation.mutate(person.id)
                        }
                      }}
                      className="p-1.5 rounded-lg"
                      style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                      title="Delete face registration"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setRegisterTarget(person)}
                  className="p-1.5 rounded-lg"
                  style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.2)' }}
                  title="Update face"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {person.registered_at && (
                <p className="text-xs mt-2" style={{ color: '#334155' }}>
                  Registered {format(new Date(person.registered_at), 'MMM dd, yyyy')}
                </p>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {registerTarget && (
          <RegisterFaceModal person={registerTarget} onClose={() => setRegisterTarget(null)} />
        )}
        {showSearch && (
          <SearchModal onClose={() => setShowSearch(false)} />
        )}
        {showAddPerson && (
          <AddPersonModal onClose={() => setShowAddPerson(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
