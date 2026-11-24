import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { DashboardProvider } from './context/DashboardProvider.jsx'
import { DashboardDataProvider } from './context/DataProvider.jsx'
import AuthGate from './AuthGate.jsx'
import { AuthProvider } from './context/AuthProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <DashboardProvider>
          <DashboardDataProvider>
            <App />
          </DashboardDataProvider>
        </DashboardProvider>
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
)
