import { useMemo, useState } from 'react'
import { DashboardContext } from './dashboardContext'

export function DashboardProvider({ children }) {
  const [activePage, setActivePage] = useState('overview')

  const value = useMemo(
    () => ({ activePage, setActivePage }),
    [activePage],
  )

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  )
}
