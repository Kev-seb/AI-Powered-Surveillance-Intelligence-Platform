import { useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

export default function Login() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('Admin@1234')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await authApi.login(username, password)
      setAuth(data.access_token, data.refresh_token, {
        id: data.user_id,
        username: data.username,
        role: data.role,
      })
      navigate('/')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center grid-bg relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-5"
        style={{ background: 'radial-gradient(circle, #00d4ff, transparent)', filter: 'blur(60px)' }} />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full opacity-5"
        style={{ background: 'radial-gradient(circle, #7c3aed, transparent)', filter: 'blur(60px)' }} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="glass-card p-10 w-full max-w-sm relative"
      >
        {/* Scan line */}
        <div className="scan-overlay rounded-xl">
          <div className="scan-line" />
        </div>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-2xl" style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.15)' }}>
              <Shield className="w-10 h-10" style={{ color: '#00d4ff' }} />
            </div>
          </div>
          <h1 className="text-xl font-bold tracking-wide" style={{ color: '#e2e8f0' }}>
            ASIP
          </h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            AI Surveillance Intelligence Platform
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#64748b' }}>
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="asip-input"
              placeholder="Enter username"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#64748b' }}>
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="asip-input pr-10"
                placeholder="Enter password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                {showPassword
                  ? <EyeOff className="w-4 h-4" style={{ color: '#475569' }} />
                  : <Eye className="w-4 h-4" style={{ color: '#475569' }} />
                }
              </button>
            </div>
          </div>

          <button
            id="login-btn"
            type="submit"
            disabled={loading}
            className="btn-glow w-full py-2.5 flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Access System'
            )}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: '#334155' }}>
          Default: admin / Admin@1234
        </p>
      </motion.div>
    </div>
  )
}
