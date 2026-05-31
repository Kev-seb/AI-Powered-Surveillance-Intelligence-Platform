import axios from 'axios'
import { useAuthStore } from '@/store/authStore'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ── API Methods ───────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
}

export const videosApi = {
  list: (params?: object) => api.get('/videos/', { params }).then((r) => r.data),
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/videos/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },
  process: (id: string, options: object) =>
    api.post(`/videos/${id}/process`, options).then((r) => r.data),
  status: (id: string) => api.get(`/videos/${id}/status`).then((r) => r.data),
  delete: (id: string) => api.delete(`/videos/${id}`).then((r) => r.data),
}

export const eventsApi = {
  list: (params?: object) => api.get('/events/', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/events/${id}`).then((r) => r.data),
  acknowledge: (id: string, note?: string) =>
    api.post(`/events/${id}/acknowledge`, { note }).then((r) => r.data),
}

export const personsApi = {
  list: (params?: object) => api.get('/persons/', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/persons/${id}`).then((r) => r.data),
  card: (id: string) => api.get(`/persons/${id}/card`).then((r) => r.data),
  create: (data: { name: string; alias?: string; risk_level: string; notes?: string }) =>
    api.post('/persons/', data).then((r) => r.data),
  registerFace: (personId: string, photo: File) => {
    const form = new FormData()
    form.append('person_id', personId)
    form.append('photo', photo)
    return api.post('/faces/register', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },
  deleteFace: (personId: string) =>
    api.delete(`/faces/${personId}`).then((r) => r.data),
  delete: (id: string) =>
    api.delete(`/persons/${id}`).then((r) => r.data),
}

export const alertsApi = {
  list: (params?: object) => api.get('/alerts/', { params }).then((r) => r.data),
  markRead: (id: string) => api.post(`/alerts/${id}/read`).then((r) => r.data),
}

export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard').then((r) => r.data),
  heatmap: (videoId?: string) =>
    api.get('/analytics/heatmap', { params: { video_id: videoId } }).then((r) => r.data),
  timeline: (videoId: string) =>
    api.get('/analytics/timeline', { params: { video_id: videoId } }).then((r) => r.data),
  trends: (days?: number) =>
    api.get('/analytics/trends', { params: { days } }).then((r) => r.data),
  personActivity: (days?: number) =>
    api.get('/analytics/person-activity', { params: { days } }).then((r) => r.data),
}

export const reportsApi = {
  generateIncident: (eventId: string) =>
    api.get(`/reports/incident/${eventId}`).then((r) => r.data),
  downloadDocx: (reportId: string) =>
    api.get(`/reports/incident/${reportId}/download`, { responseType: 'blob' }),
  exportCsv: (params?: object) =>
    api.get('/reports/events/export', { params, responseType: 'blob' }),
  captureSnapshot: (videoId: string, timestampSecs: number, eventId?: string) =>
    api.post(`/reports/snapshot/${videoId}`, null, {
      params: { timestamp_secs: timestampSecs, event_id: eventId },
    }).then(r => r.data),
  listSnapshots: (videoId?: string) =>
    api.get('/reports/snapshots', { params: { video_id: videoId } }).then(r => r.data),
  downloadSnapshot: (snapName: string) =>
    api.get(`/reports/snapshot/download/${snapName}`, { responseType: 'blob' }),
  deleteSnapshot: (snapName: string) =>
    api.delete(`/reports/snapshot/${snapName}`).then(r => r.data),
}

export const healthApi = {
  check: () => api.get('/health').then((r) => r.data),
}

export const auditApi = {
  list: (params?: object) => api.get('/audit/', { params }).then(r => r.data),
  summary: () => api.get('/audit/summary').then(r => r.data),
  exportCsv: (params?: object) =>
    api.get('/audit/export', { params, responseType: 'blob' }),
}

export const zonesApi = {
  list: () => api.get('/zones/').then(r => r.data),
  create: (zone: object) => api.post('/zones/', zone).then(r => r.data),
  update: (id: string, zone: object) => api.put(`/zones/${id}`, zone).then(r => r.data),
  delete: (id: string) => api.delete(`/zones/${id}`).then(r => r.data),
  analytics: () => api.get('/zones/analytics').then(r => r.data),
}

export const systemApi = {
  health: () => api.get('/system/system').then(r => r.data),
}

export const detectApi = {
  /**
   * Send a single video frame blob for real-time YOLO+face detection.
   * Returns { detections, width, height, inference_ms }
   */
  frame: (blob: Blob, detectFaces = true) => {
    const form = new FormData()
    form.append('file', blob, 'frame.jpg')
    return api.post(`/detect/frame?detect_faces=${detectFaces}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}
