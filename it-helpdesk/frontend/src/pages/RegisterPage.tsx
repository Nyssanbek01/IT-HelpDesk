import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Brand from '../components/Brand'

function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      setError('Заполните все поля.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Введите корректный email.')
      return
    }
    if (password.length < 8) {
      setError('Пароль должен содержать не менее 8 символов.')
      return
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      const data = await response.json() as { message?: string }

      if (!response.ok) {
        setError(response.status === 409 ? 'Аккаунт с таким email уже существует.' : data.message ?? 'Не удалось создать аккаунт.')
        return
      }

      navigate('/login', { replace: true, state: { registered: true } })
    } catch {
      setError('Сервер недоступен. Проверьте подключение и повторите попытку.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page auth-page--register">
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
          <p className="intro-caption">Одно пространство для слаженной технической поддержки.</p>
        </div>

        <section className="auth-card" aria-labelledby="register-title">
          <div className="card-kicker">НОВАЯ УЧЁТНАЯ ЗАПИСЬ</div>
          <h2 id="register-title">Создать аккаунт</h2>
          <p className="card-description">Заполните данные для доступа к рабочему пространству.</p>
          {error && <div className="notice notice--error" role="alert">{error}</div>}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="register-name">Имя</label>
            <input
              autoComplete="name"
              className="text-input"
              id="register-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Как к вам обращаться"
              required
              type="text"
              value={name}
            />

            <label className="field-label" htmlFor="register-email">Email</label>
            <input
              autoComplete="email"
              className="text-input"
              id="register-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              type="email"
              value={email}
            />

            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="register-password">Пароль</label>
                <input
                  autoComplete="new-password"
                  className="text-input"
                  id="register-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="От 8 символов"
                  required
                  type="password"
                  value={password}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="register-confirm">Повторите пароль</label>
                <input
                  autoComplete="new-password"
                  className="text-input"
                  id="register-confirm"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Ещё раз"
                  required
                  type="password"
                  value={confirmPassword}
                />
              </div>
            </div>

            <button className="primary-button auth-submit" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Создаём аккаунт…' : 'Создать аккаунт'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="auth-switch">Уже есть аккаунт? <Link to="/login">Войти</Link></p>
        </section>
      </section>

      <footer className="auth-footer"><span>IT HELPDESK</span><span>СЛУЖБА ТЕХНИЧЕСКОЙ ПОДДЕРЖКИ</span></footer>
    </main>
  )
}

export default RegisterPage
