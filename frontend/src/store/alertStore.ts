import { create } from 'zustand'

export interface LiveAlert {
  id: string
  type: string
  severity: string
  title: string
  description: string
  threat_score: number
  timestamp: string
}

interface AlertState {
  alerts: LiveAlert[]
  unreadCount: number
  isConnected: boolean
  addAlert: (alert: LiveAlert) => void
  markAllRead: () => void
  setConnected: (connected: boolean) => void
  clearAlerts: () => void
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  unreadCount: 0,
  isConnected: false,
  addAlert: (alert) =>
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 100),
      unreadCount: state.unreadCount + 1,
    })),
  markAllRead: () => set({ unreadCount: 0 }),
  setConnected: (connected) => set({ isConnected: connected }),
  clearAlerts: () => set({ alerts: [], unreadCount: 0 }),
}))
