import { NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Video, AlertTriangle, Users,
  FileText, LogOut, Wifi, WifiOff, Bell,
  Shield, Activity, Scan, BarChart2, ClipboardList,
  Heart, Camera, Map, Layers, Image,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useAlertStore } from '@/store/alertStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useState, useEffect } from 'react'

const NAV_ITEMS = [
  { path: '/',           icon: LayoutDashboard,  label: 'Dashboard',   group: 'main' },
  { path: '/video',      icon: Video,            label: 'Video Intel', group: 'main' },
  { path: '/cameras',    icon: Camera,           label: 'Live Cameras', group: 'main' },
  { path: '/incidents',  icon: AlertTriangle,    label: 'Incidents',   group: 'main' },
  { path: '/persons',    icon: Users,            label: 'Persons',     group: 'intel' },
  { path: '/faces',      icon: Scan,             label: 'Face Registry', group: 'intel' },
  { path: '/zones',      icon: Map,              label: 'Zone Intel',  group: 'intel' },
  { path: '/trajectory', icon: Activity,         label: 'Trajectory',  group: 'intel' },
  { path: '/analytics',  icon: BarChart2,        label: 'Analytics',   group: 'intel' },
  { path: '/evidence',   icon: Image,            label: 'Evidence',    group: 'ops' },
  { path: '/reports',    icon: FileText,         label: 'Reports',     group: 'ops' },
  { path: '/audit',      icon: ClipboardList,    label: 'Audit Log',   group: 'ops' },
  { path: '/health',     icon: Heart,            label: 'System Health', group: 'ops' },
]

const GROUPS = [
  { id: 'main',  label: 'Operations' },
  { id: 'intel', label: 'Intelligence' },
  { id: 'ops',   label: 'Platform' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, clearAuth } = useAuthStore()
  const { unreadCount } = useAlertStore()
  const { isConnected } = useWebSocket()
  const navigate = useNavigate()
  const [clock, setClock] = useState(new Date().toLocaleTimeString())

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden grid-bg">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <motion.aside
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="w-56 flex-shrink-0 flex flex-col"
        style={{
          background: 'rgba(9, 13, 26, 0.97)',
          borderRight: '1px solid rgba(0, 212, 255, 0.08)',
        }}
      >
        {/* Logo */}
        <div className="p-4 border-b" style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Shield className="w-7 h-7" style={{ color: '#00d4ff' }} />
              <span className="status-dot status-live absolute -top-1 -right-1" style={{ width: 6, height: 6 }} />
            </div>
            <div>
              <div className="font-bold text-sm tracking-wider" style={{ color: '#00d4ff' }}>ASIP</div>
              <div className="text-xs" style={{ color: '#334155' }}>Intelligence Platform</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 overflow-y-auto space-y-4 py-3">
          {GROUPS.map(({ id, label }) => {
            const items = NAV_ITEMS.filter(n => n.group === id)
            return (
              <div key={id}>
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-widest mb-1"
                  style={{ color: '#1e293b', letterSpacing: '0.1em' }}>
                  {label}
                </p>
                {items.map(({ path, icon: Icon, label }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === '/'}
                    className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t space-y-2" style={{ borderColor: 'rgba(0,212,255,0.08)' }}>
          {/* Connection Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: 'rgba(0,212,255,0.03)' }}>
            {isConnected
              ? <><Wifi className="w-3 h-3" style={{ color: '#10b981' }} /><span style={{ color: '#10b981' }}>Live</span></>
              : <><WifiOff className="w-3 h-3" style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>Offline</span></>
            }
            <span className="ml-auto font-mono text-xs" style={{ color: '#1e293b' }}>{clock}</span>
          </div>
          {/* User */}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, #00d4ff22, #7c3aed22)', border: '1px solid rgba(0,212,255,0.2)', color: '#00d4ff' }}>
              {user?.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>{user?.username}</div>
              <div className="text-xs capitalize" style={{ color: '#334155' }}>{user?.role}</div>
            </div>
            <button
              onClick={() => { clearAuth(); navigate('/login') }}
              className="p-1 rounded hover:bg-red-500/10 transition-colors"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5" style={{ color: '#64748b' }} />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* ── Main Content ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-6 py-2.5 flex-shrink-0"
          style={{
            background: 'rgba(9, 13, 26, 0.92)',
            borderBottom: '1px solid rgba(0, 212, 255, 0.06)',
          }}>
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4" style={{ color: '#00d4ff' }} />
            <span className="text-sm font-medium" style={{ color: '#64748b' }}>
              Surveillance Operations Center
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
              ONLINE
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
              <Bell className="w-4 h-4" style={{ color: '#94a3b8' }} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: '#ef4444', color: 'white', fontSize: '9px' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-5">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  )
}
