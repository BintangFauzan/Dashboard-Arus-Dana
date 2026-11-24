import { createContext, useContext } from 'react'

export const DataContext = createContext(null)

export function useDashboardData() {
  const context = useContext(DataContext)

  if (!context) {
    throw new Error('useDashboardData harus digunakan di dalam DashboardDataProvider.')
  }

  return context
}
