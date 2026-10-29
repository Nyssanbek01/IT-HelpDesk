import type { AuthUser } from '../auth/AuthContext'

export type TicketAttachment = {
  id: number
  ticketId: number
  originalName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  uploadedBy: { id: number; name: string; role: string }
}

export const attachmentAccept = '.png,.jpg,.jpeg,.webp,.pdf,.txt,.docx'
export const maximumAttachments = 10
export const maximumFileSize = 10 * 1024 * 1024

export function validateAttachment(file: Pick<File, 'name' | 'size'>) {
  if (file.size < 1) return 'Нельзя загрузить пустой файл.'
  if (file.size > maximumFileSize) return 'Размер файла не должен превышать 10 МБ.'
  if (!/\.(png|jpe?g|webp|pdf|txt|docx)$/i.test(file.name)) {
    return 'Допустимы PNG, JPG, WEBP, PDF, TXT и DOCX.'
  }
  return ''
}

export function canDeleteAttachment(user: AuthUser | null, attachment: TicketAttachment) {
  return Boolean(user && (user.role === 'admin' || user.id === attachment.uploadedBy.id))
}

export function formatAttachmentSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`
    : `${(bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`
}

const errorMessages: Record<string, string> = {
  'A ticket can have at most 10 attachments': 'В заявке уже 10 вложений. Удалите одно из доступных вам вложений.',
  'File exceeds the 10 MB limit': 'Размер файла не должен превышать 10 МБ.',
  'File size must be between 1 byte and 10 MB': 'Размер файла должен быть от 1 байта до 10 МБ.',
  'File name extension does not match file content': 'Расширение файла не соответствует его содержимому.',
  'File content type is not allowed': 'Этот тип содержимого файла не разрешён.',
  'File is not a valid DOCX document': 'Файл не является корректным документом DOCX.',
  'File is not valid UTF-8 plain text': 'TXT должен содержать обычный текст в UTF-8.',
  'Attachment file is missing': 'Файл вложения отсутствует на сервере.',
  'Attachment was removed from the ticket; physical cleanup is pending': 'Вложение удалено из заявки. Очистка файла на сервере ещё не завершена.',
}

export async function checkAttachmentResponse(response: Response, onUnauthorized: () => void) {
  if (response.ok) return
  if (response.status === 401) {
    onUnauthorized()
    throw new Error('Сессия истекла. Войдите снова.')
  }
  const body = await response.json().catch(() => ({})) as { message?: string }
  if (body.message && errorMessages[body.message]) throw new Error(errorMessages[body.message])
  if (response.status === 403) throw new Error('Недостаточно прав. Можно удалять только свои вложения.')
  if (response.status === 404) throw new Error('Заявка или вложение не найдены либо недоступны.')
  if (response.status === 413) throw new Error('Превышен лимит: до 10 файлов на заявку, до 10 МБ каждый.')
  if (response.status === 415) throw new Error('Содержимое файла не соответствует разрешённому формату.')
  if (response.status === 400) throw new Error('Не удалось принять файл. Выберите один файл разрешённого формата.')
  throw new Error('Не удалось выполнить операцию с вложением. Попробуйте ещё раз.')
}
