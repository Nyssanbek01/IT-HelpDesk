import { apiFetch } from '../api/client'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

function TicketCreatePage() {
	const navigate = useNavigate()
	const { token, clearSession } = useAuth()
	const [title, setTitle] = useState('')
	const [description, setDescription] = useState('')
	const [priority, setPriority] = useState('medium')
	const [error, setError] = useState('')
	const [isSubmitting, setIsSubmitting] = useState(false)

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError('')
		setIsSubmitting(true)

		try {
			const response = await apiFetch('/api/tickets', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					title: title.trim(),
					description: description.trim(),
					priority,
				}),
			})

			const data = await response.json() as { message?: string }

			if (response.status === 401) {
				clearSession()
				navigate('/login', { replace: true })
				return
			}

			if (!response.ok) {
				setError(data.message ?? 'Не удалось создать заявку. Попробуйте ещё раз.')
				return
			}

			navigate('/tickets', { replace: true })
		} catch {
			setError('Сервер недоступен. Проверьте подключение и повторите попытку.')
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<main className="dashboard-content ticket-page-content">
			<div className="dashboard-heading ticket-form-heading">
				<div>
					<p className="eyebrow"><span /> НОВОЕ ОБРАЩЕНИЕ</p>
					<h1>Создать заявку</h1>
					<p className="dashboard-welcome">Опишите проблему, и служба поддержки поможет её решить.</p>
				</div>
				<Link className="back-link" to="/tickets"><span aria-hidden="true">←</span> К моим заявкам</Link>
			</div>

			<section className="ticket-form-panel">
				{error && <div className="notice notice--error" role="alert">{error}</div>}
				<form className="ticket-form" onSubmit={handleSubmit}>
					<label className="field-label" htmlFor="ticket-title">Заголовок</label>
					<input
						autoComplete="off"
						className="text-input"
						id="ticket-title"
						maxLength={160}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="Кратко опишите проблему"
						required
						value={title}
					/>

					<label className="field-label" htmlFor="ticket-description">Описание проблемы</label>
					<textarea
						className="text-input ticket-description-input"
						id="ticket-description"
						maxLength={10000}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="Что произошло? Какие действия уже пробовали?"
						required
						value={description}
					/>

					<label className="field-label" htmlFor="ticket-priority">Приоритет</label>
					<select
						className="text-input ticket-select"
						id="ticket-priority"
						onChange={(event) => setPriority(event.target.value)}
						value={priority}
					>
						<option value="low">Низкий</option>
						<option value="medium">Средний</option>
						<option value="high">Высокий</option>
					</select>

					<div className="ticket-form-actions">
						<Link className="secondary-button" to="/tickets">Отмена</Link>
						<button className="primary-button create-ticket-button" disabled={isSubmitting} type="submit">
							{isSubmitting ? 'Создаём…' : 'Создать заявку'}
							<span aria-hidden="true">→</span>
						</button>
					</div>
				</form>
			</section>
		</main>
	)
}

export default TicketCreatePage
