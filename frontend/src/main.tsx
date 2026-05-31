import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0d1224',
            border: '1px solid rgba(0,212,255,0.2)',
            color: '#e2e8f0',
            fontFamily: 'Inter, sans-serif',
            fontSize: '13px',
          },
          duration: 4000,
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
)
