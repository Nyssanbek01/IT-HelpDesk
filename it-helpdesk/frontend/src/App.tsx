import { Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import AuthenticatedLayout from './components/AuthenticatedLayout'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import EngineerDashboardPage from './pages/EngineerDashboardPage'
import EngineerTicketPage from './pages/EngineerTicketPage'
import TicketCreatePage from './pages/TicketCreatePage'
import TicketDetailPage from './pages/TicketDetailPage'
import TicketsPage from './pages/TicketsPage'
import RequireEngineer from './components/RequireEngineer'
import RequireAdmin from './components/RequireAdmin'
import AdminDashboardPage from './pages/AdminDashboardPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminTicketsPage from './pages/AdminTicketsPage'
import AdminTicketDetailPage from './pages/AdminTicketDetailPage'
const AdminAnalyticsPage = lazy(() => import('./pages/AdminAnalyticsPage'))

function HomeRedirect() {
  const { token, user } = useAuth()
  const destination = user?.role === 'admin' ? '/admin' : user?.role === 'engineer' ? '/engineer' : '/dashboard'
  return <Navigate to={token ? destination : '/login'} replace />
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<AuthenticatedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/new" element={<TicketCreatePage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/analytics" element={<Suspense fallback={<div role="status">Загружаем аналитику…</div>}><AdminAnalyticsPage /></Suspense>} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/tickets" element={<AdminTicketsPage />} />
            <Route path="/admin/tickets/:id" element={<AdminTicketDetailPage />} />
          </Route>
          <Route element={<RequireEngineer />}>
            <Route path="/engineer" element={<EngineerDashboardPage />} />
            <Route path="/engineer/tickets/:id" element={<EngineerTicketPage />} />
          </Route>
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
