import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Users, User, AlertTriangle, Clock,
  TrendingUp, Eye, Shield, Search,
} from 'lucide-react'
import { personsApi } from '@/api/client'
import { format } from 'date-fns'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts'

function RiskBadge({ risk }: { risk: string }) {
  const colors = {
    unknown: '#64748b',
    low: '#10b981',
    medium: '#f59e0b',
    high: '#ef4444',
    critical: '#dc2626',
  }
  const color = colors[risk as keyof typeof colors] || '#64748b'
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
      {risk.toUpperCase()}
    </span>
  )
}

function PersonCard({ person, onClick, selected }: {
  person: any, onClick: () => void, selected: boolean
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className="glass-card p-4 cursor-pointer"
      style={{
        borderColor: selected ? 'rgba(0,212,255,0.3)' : 'rgba(0,212,255,0.08)',
        background: selected ? 'rgba(0,212,255,0.04)' : undefined,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(124,58,237,0.15))',
            border: '1px solid rgba(0,212,255,0.2)',
            color: '#00d4ff',
          }}>
          {person.name ? person.name[0].toUpperCase() : '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>
              {person.name || `Unknown #${person.id.slice(0, 6)}`}
            </p>
            {person.is_registered && (
              <Shield className="w-3 h-3 flex-shrink-0" style={{ color: '#00d4ff' }} />
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <RiskBadge risk={person.risk_level} />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function PersonDetail({ personId }: { personId: string }) {
  const { data: card, isLoading } = useQuery({
    queryKey: ['person-card', personId],
    queryFn: () => personsApi.card(personId),
  })

  if (isLoading) return <div className="flex justify-center py-16"><div className="spinner" /></div>
  if (!card) return null

  const { person, total_events, first_seen, last_seen, avg_threat_score, behavior_summary, recent_events } = card

  const radarData = Object.entries(behavior_summary || {}).map(([key, val]) => ({
    behavior: key.replace(/_/g, ' '),
    count: val,
  }))

  return (
    <div className="space-y-5">
      {/* Profile Header */}
      <div className="glass-card p-6">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
            style={{
              background: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(124,58,237,0.15))',
              border: '1px solid rgba(0,212,255,0.2)',
              color: '#00d4ff',
            }}>
            {person.name ? person.name[0].toUpperCase() : '?'}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold" style={{ color: '#e2e8f0' }}>
                {person.name || 'Unknown Person'}
              </h2>
              <RiskBadge risk={person.risk_level} />
              {person.is_registered && (
                <span className="flex items-center gap-1 text-xs" style={{ color: '#00d4ff' }}>
                  <Shield className="w-3 h-3" /> Registered
                </span>
              )}
            </div>
            {person.alias && (
              <p className="text-sm mt-1" style={{ color: '#64748b' }}>Also known as: {person.alias}</p>
            )}
            {person.notes && (
              <p className="text-sm mt-2" style={{ color: '#94a3b8' }}>{person.notes}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mt-6">
          {[
            { label: 'Total Events', value: total_events, icon: AlertTriangle, color: '#00d4ff' },
            { label: 'Visit Count', value: card.visit_count, icon: Eye, color: '#7c3aed' },
            { label: 'Avg Threat', value: `${(avg_threat_score * 100).toFixed(0)}%`, icon: TrendingUp, color: avg_threat_score > 0.6 ? '#ef4444' : '#10b981' },
            { label: 'Active Since', value: first_seen ? format(new Date(first_seen), 'MMM dd') : '—', icon: Clock, color: '#f59e0b' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="text-center p-3 rounded-xl"
              style={{ background: `${color}08`, border: `1px solid ${color}18` }}>
              <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
              <p className="text-lg font-bold" style={{ color }}>{value}</p>
              <p className="text-xs mt-0.5" style={{ color: '#475569' }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Behavior Radar */}
      {radarData.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>Behavior Profile</h3>
          <ResponsiveContainer width="100%" height={180}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(0,212,255,0.1)" />
              <PolarAngleAxis dataKey="behavior" tick={{ fontSize: 10, fill: '#64748b' }} />
              <Radar dataKey="count" stroke="#00d4ff" fill="#00d4ff" fillOpacity={0.15} strokeWidth={1.5} />
              <Tooltip contentStyle={{ background: '#0d1224', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 8 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent Events */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#94a3b8' }}>Recent Events</h3>
        <div className="space-y-2">
          {recent_events.slice(0, 5).map((ev: any) => (
            <div key={ev.id} className="flex items-center gap-3 py-2 border-b text-xs"
              style={{ borderColor: 'rgba(0,212,255,0.04)' }}>
              <span className={`badge badge-${ev.severity}`}>{ev.severity}</span>
              <span style={{ color: '#94a3b8' }}>
                {ev.event_type.replace(/_/g, ' ')}
              </span>
              <span className="ml-auto" style={{ color: '#475569' }}>
                {format(new Date(ev.timestamp), 'MMM dd HH:mm')}
              </span>
            </div>
          ))}
          {recent_events.length === 0 && (
            <p className="text-xs" style={{ color: '#334155' }}>No events recorded</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PersonIntelligence() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState('all')

  const { data: persons = [], isLoading } = useQuery({
    queryKey: ['persons', riskFilter],
    queryFn: () => personsApi.list({
      risk_level: riskFilter === 'all' ? undefined : riskFilter,
      limit: 100,
    }),
  })

  const filtered = persons.filter((p: any) =>
    !search || (p.name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>Person Intelligence</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            {persons.length} persons in registry
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Person List */}
        <div className="space-y-3">
          {/* Search + Filter */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#475569' }} />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="asip-input pl-9" placeholder="Search persons..."
            />
          </div>
          <select className="asip-input text-xs py-1.5" value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}>
            <option value="all">All Risk Levels</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {isLoading ? (
            <div className="flex justify-center py-8"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-20" style={{ color: '#00d4ff' }} />
              <p className="text-xs" style={{ color: '#334155' }}>No persons found</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
              {filtered.map((person: any) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  selected={selectedId === person.id}
                  onClick={() => setSelectedId(person.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Person Detail */}
        <div className="col-span-2">
          {selectedId ? (
            <PersonDetail personId={selectedId} />
          ) : (
            <div className="glass-card p-16 text-center h-full flex flex-col items-center justify-center">
              <User className="w-16 h-16 mb-4 opacity-10" style={{ color: '#00d4ff' }} />
              <p className="text-sm" style={{ color: '#334155' }}>
                Select a person to view their intelligence card
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
