import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

function RequireEngineer() {
  const { user } = useAuth()
  if (user?.role !== 'engineer' && user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }
  return <Outlet />
}

export default RequireEngineer
