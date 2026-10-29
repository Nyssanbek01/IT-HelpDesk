export const notificationsChangedEvent = 'helpdesk:notifications-changed'

// Existing pages use fetch directly; keep its interface and centralize refresh events.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  const method = init?.method?.toUpperCase() ?? 'GET'
  const url = String(input)
  if (response.ok && !['GET', 'HEAD'].includes(method) && /^\/api\/(tickets|engineer|admin)(\/|$)/.test(url)) {
    window.dispatchEvent(new Event(notificationsChangedEvent))
  }
  return response
}
