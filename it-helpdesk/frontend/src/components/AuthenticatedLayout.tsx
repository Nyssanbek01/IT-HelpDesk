import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Brand from './Brand'
import NotificationBell from './NotificationBell'
import { useAuth, type AuthUser } from '../auth/AuthContext'

function AuthenticatedLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { token, user, setUser, clearSession } = useAuth()
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    if (!token) {
      clearSession()
      navigate('/login', { replace: true })
      return
    }

    const controller = new AbortController()
    let isCurrent = true

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Session validation failed')
        }
        return response.json() as Promise<AuthUser>
      })
      .then((currentUser) => {
        if (isCurrent) {
          setUser({ id: currentUser.id, name: currentUser.name, email: currentUser.email, role: currentUser.role })
          setIsChecking(false)
        }
      })
      .catch(() => {
        if (isCurrent) {
          clearSession()
          navigate('/login', { replace: true })
        }
      })

    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [token])

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  if (isChecking || !user) {
    return (
      <main className="session-loading" role="status">
        <span className="loading-mark">IT</span>
        <span>Проверяем доступ…</span>
      </main>
    )
  }

  const roleLabel = user.role === 'user' ? 'Пользователь' : user.role === 'engineer' ? 'Инженер' : user.role === 'admin' ? 'Администратор' : user.role
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
  const isAdmin = user.role === 'admin'
  const isEngineer = user.role === 'engineer'
  const isEngineerPage = location.pathname.startsWith('/engineer')
  const isAdminPage = location.pathname.startsWith('/admin')
  const isDashboard = location.pathname === '/dashboard'
  const isTickets = location.pathname === '/tickets' || /^\/tickets\/\d+$/.test(location.pathname)
  const isCreate = location.pathname === '/tickets/new'
  const engineerMine = location.search === '?scope=mine'
  const pageTitle = isAdminPage
    ? location.pathname === '/admin' ? 'Admin Panel' : location.pathname === '/admin/users' ? 'Пользователи' : location.pathname.includes('/tickets/') ? 'Детали заявки' : 'Все заявки'
    : isEngineerPage
    ? location.pathname.includes('/tickets/') ? 'Заявка' : engineerMine ? 'Мои заявки' : location.search === '?scope=all' ? 'Все заявки' : 'Панель инженера'
    : isDashboard ? 'Главная' : isCreate ? 'Создать заявку' : isTickets ? 'Мои заявки' : 'Заявка'

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Brand light />
        <div className="sidebar-section-label">{isAdmin ? 'ADMIN PANEL' : isEngineer ? 'ПАНЕЛЬ ИНЖЕНЕРА' : 'РАБОЧЕЕ ПРОСТРАНСТВО'}</div>
        <nav className="sidebar-nav" aria-label="Главная навигация">
          {isAdmin ? (
            <>
              <Link className={`sidebar-link${location.pathname === '/admin' ? ' sidebar-link--active' : ''}`} to="/admin" aria-current={location.pathname === '/admin' ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--home" aria-hidden="true" /><span>Обзор</span>
              </Link>
              <Link className={`sidebar-link${location.pathname === '/admin/users' ? ' sidebar-link--active' : ''}`} to="/admin/users" aria-current={location.pathname === '/admin/users' ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--tickets" aria-hidden="true" /><span>Пользователи</span>
              </Link>
              <Link className={`sidebar-link${location.pathname.startsWith('/admin/tickets') ? ' sidebar-link--active' : ''}`} to="/admin/tickets" aria-current={location.pathname.startsWith('/admin/tickets') ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--create" aria-hidden="true" /><span>Все заявки</span>
              </Link>
            </>
          ) : isEngineer ? (
            <>
              <Link className={`sidebar-link${isEngineerPage && !location.search && !location.pathname.includes('/tickets/') ? ' sidebar-link--active' : ''}`} to="/engineer" aria-current={isEngineerPage && !location.search && !location.pathname.includes('/tickets/') ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--home" aria-hidden="true" /><span>Панель инженера</span>
              </Link>
              <Link className={`sidebar-link${isEngineerPage && location.search === '?scope=all' ? ' sidebar-link--active' : ''}`} to="/engineer?scope=all" aria-current={isEngineerPage && location.search === '?scope=all' ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--home" aria-hidden="true" /><span>Все заявки</span>
              </Link>
              <Link className={`sidebar-link${isEngineerPage && engineerMine ? ' sidebar-link--active' : ''}`} to="/engineer?scope=mine" aria-current={isEngineerPage && engineerMine ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--tickets" aria-hidden="true" /><span>Мои заявки</span>
              </Link>
            </>
          ) : (
            <>
              <Link className={`sidebar-link${isDashboard ? ' sidebar-link--active' : ''}`} to="/dashboard" aria-current={isDashboard ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--home" aria-hidden="true" /><span>Главная</span>
              </Link>
              <Link className={`sidebar-link${isTickets ? ' sidebar-link--active' : ''}`} to="/tickets" aria-current={isTickets ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--tickets" aria-hidden="true" /><span>Мои заявки</span>
              </Link>
              <Link className={`sidebar-link${isCreate ? ' sidebar-link--active' : ''}`} to="/tickets/new" aria-current={isCreate ? 'page' : undefined}>
                <span className="nav-glyph nav-glyph--create" aria-hidden="true" /><span>Создать заявку</span>
              </Link>
            </>
          )}
        </nav>

        <div className="sidebar-bottom">
          {isEngineer ? (
            <div className="engineer-sidebar-identity"><span className="support-dot" /><span>{user.name}</span></div>
          ) : (
            <div className="sidebar-support-line"><span className="support-dot" /> Система работает штатно</div>
          )}
          <button className="sidebar-logout" onClick={handleLogout} type="button"><span aria-hidden="true">↪</span> Выйти</button>
          <div className="sidebar-version">IT HELPDESK <span>·</span> 1.0</div>
        </div>

        <div className="mobile-sidebar-logout">
          <button className="sidebar-logout" onClick={handleLogout} type="button"><span aria-hidden="true">↪</span> Выйти</button>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="breadcrumb"><span>Рабочее пространство</span><span aria-hidden="true">/</span><strong>{pageTitle}</strong></div>
          <div className="profile-area">
            <NotificationBell />
            <div className="profile-avatar" aria-hidden="true">{initials || 'IT'}</div>
            <div className="profile-copy">
              <span className="profile-name">{user.name}</span>
              <span className="profile-role">{roleLabel}</span>
            </div>
            <button className="topbar-logout" onClick={handleLogout} type="button" aria-label="Выйти"><span aria-hidden="true">↪</span></button>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  )
}

export default AuthenticatedLayout
