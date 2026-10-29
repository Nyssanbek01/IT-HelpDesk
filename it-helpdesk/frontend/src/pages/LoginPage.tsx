import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, type AuthUser } from '../auth/AuthContext'
import Brand from '../components/Brand'

type LoginResponse = {
  token?: string
  user?: AuthUser
}

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const registrationSuccess = (location.state as { registered?: boolean } | null)?.registered

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await response.json() as LoginResponse

      if (!response.ok || !data.token || !data.user) {
        setError(response.status === 401 ? 'Неверный email или пароль.' : 'Не удалось войти. Попробуйте ещё раз.')
        return
      }

      setSession(data.token, data.user)
      navigate(data.user.role === 'admin' ? '/admin' : data.user.role === 'engineer' ? '/engineer' : '/dashboard', { replace: true })
    } catch {
      setError('Сервер недоступен. Проверьте подключение и повторите попытку.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <Brand />
        <span className="auth-topbar-note">ПОДДЕРЖКА, КОТОРАЯ РЯДОМ</span>
      </header>

      <section className="auth-layout">
        <div className="auth-intro">
          <p className="eyebrow"><span /> IT OPERATIONS</p>
          <h1>IT HelpDesk</h1>
          <p className="auth-tagline">Система управления заявками технической поддержки</p>
          <div className="intro-rule" />
          <p className="intro-caption">Техническая помощь начинается с простого входа.</p>
        </div>

        <section className="auth-card" aria-labelledby="login-title">
          <div className="card-kicker">РАБОЧЕЕ ПРОСТРАНСТВО</div>
          <h2 id="login-title">С возвращением</h2>
          <p className="card-description">Войдите, чтобы продолжить работу с обращениями.</p>

          {registrationSuccess && <div className="notice notice--success" role="status">Аккаунт успешно создан. Теперь войдите в систему.</div>}
          {error && <div className="notice notice--error" role="alert">{error}</div>}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="login-email">Email</label>
            <input
              autoComplete="email"
              className="text-input"
              id="login-email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              type="email"
              value={email}
            />

            <label className="field-label" htmlFor="login-password">Пароль</label>
            <input
              autoComplete="current-password"
              className="text-input"
              id="login-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              required
              type="password"
              value={password}
            />

            <button className="primary-button auth-submit" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Входим…' : 'Войти'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="auth-switch">Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
        </section>
      </section>

      <footer className="auth-footer"><span>IT HELPDESK</span><span>СЛУЖБА ТЕХНИЧЕСКОЙ ПОДДЕРЖКИ</span></footer>
    </main>
  )
}

export default LoginPage
