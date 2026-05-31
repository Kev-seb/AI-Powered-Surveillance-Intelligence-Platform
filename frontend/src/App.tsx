import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/Layout/Layout'
import Dashboard from '@/pages/Dashboard'
import VideoIntelligence from '@/pages/VideoIntelligence'
import IncidentCenter from '@/pages/IncidentCenter'
import PersonIntelligence from '@/pages/PersonIntelligence'
import FaceRegistry from '@/pages/FaceRegistry'
import Reports from '@/pages/Reports'
import Analytics from '@/pages/Analytics'
import AuditLog from '@/pages/AuditLog'
import SystemHealth from '@/pages/SystemHealth'
import LiveCameraGrid from '@/pages/LiveCameraGrid'
import ZoneIntelligence from '@/pages/ZoneIntelligence'
import EvidenceSnapshots from '@/pages/EvidenceSnapshots'
import TrajectoryAnalysis from '@/pages/TrajectoryAnalysis'
import Login from '@/pages/Login'
import { useAuthStore } from '@/store/authStore'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/video" element={<VideoIntelligence />} />
                  <Route path="/cameras" element={<LiveCameraGrid />} />
                  <Route path="/incidents" element={<IncidentCenter />} />
                  <Route path="/persons" element={<PersonIntelligence />} />
                  <Route path="/faces" element={<FaceRegistry />} />
                  <Route path="/zones" element={<ZoneIntelligence />} />
                  <Route path="/trajectory" element={<TrajectoryAnalysis />} />
                  <Route path="/evidence" element={<EvidenceSnapshots />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/audit" element={<AuditLog />} />
                  <Route path="/health" element={<SystemHealth />} />
                </Routes>
              </Layout>
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
