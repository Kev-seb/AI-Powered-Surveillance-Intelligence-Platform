import { useEffect, useRef, useCallback } from 'react'
import { useAlertStore } from '@/store/alertStore'
import toast from 'react-hot-toast'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/alerts/ws`

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { addAlert, setConnected } = useAlertStore()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(`${WS_URL}?channel=global`)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        console.log('[WS] Connected to alert stream')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'alert') {
            addAlert({
              id: data.alert_id || String(Date.now()),
              type: data.alert_type || 'detection',
              severity: data.severity || 'medium',
              title: data.title || 'Security Event',
              description: data.description || '',
              threat_score: data.threat_score || 0,
              timestamp: data.timestamp || new Date().toISOString(),
            })

            // Browser toast for high severity
            if (data.severity === 'critical') {
              toast.error(`🚨 CRITICAL: ${data.title}`, { duration: 8000 })
            } else if (data.severity === 'high') {
              toast(`⚠️ ${data.title}`, {
                icon: '⚠️',
                style: { borderColor: 'rgba(239, 68, 68, 0.4)' },
              })
            }
          }

          // Ping/pong keepalive
          if (data.type === 'pong') {
            // Connection alive
          }
        } catch {
          // Non-JSON message — ignore
        }
      }

      ws.onclose = () => {
        setConnected(false)
        console.log('[WS] Disconnected — reconnecting in 3s...')
        reconnectTimer.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }

    } catch (error) {
      console.error('[WS] Failed to connect:', error)
      reconnectTimer.current = setTimeout(connect, 5000)
    }
  }, [addAlert, setConnected])

  useEffect(() => {
    connect()

    // Keepalive ping every 30s
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 30_000)

    return () => {
      clearInterval(pingInterval)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { isConnected: useAlertStore((s) => s.isConnected) }
}
