import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

function RequireAdmin() {
  const { user } = useAuth()
  if (user?.role !== 'admin') {
    return <Navigate to={user?.role === 'engineer' ? '/engineer' : '/dashboard'} replace />
  }
  return <Outlet />
}

export default RequireAdmin