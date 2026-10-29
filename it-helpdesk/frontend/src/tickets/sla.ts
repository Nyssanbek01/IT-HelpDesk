export type SlaStatus = 'on_time' | 'approaching_deadline' | 'overdue' | 'met' | 'breached' | 'unknown'
export type SlaStage = { status: SlaStatus; dueAt: string | null; completedAt: string | null; remainingMs: number | null }
export type TicketSla = { serverNow: string; response: SlaStage; resolution: SlaStage }
export const slaLabels: Record<SlaStatus, string> = {
  on_time: 'В срок', approaching_deadline: 'Скоро дедлайн', overdue: 'Просрочено',
  met: 'SLA выполнен', breached: 'SLA нарушен', unknown: 'Нет достоверных данных',
}
export const slaFilterOptions = Object.entries(slaLabels)
export function remainingLabel(milliseconds: number) {
  if (milliseconds <= 0) return 'Дедлайн наступил — статус уточняет сервер'
  const minutes = Math.ceil(milliseconds / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes % 1440 / 60)
  return `Осталось ${days ? `${days} д ` : ''}${hours ? `${hours} ч ` : ''}${minutes % 60} мин`
}
