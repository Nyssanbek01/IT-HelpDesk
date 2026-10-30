CREATE INDEX "Ticket_resolvedAt_id_idx" ON "Ticket"("resolvedAt", "id");
CREATE INDEX "TicketHistory_ticketId_action_newValue_createdAt_idx" ON "TicketHistory"("ticketId", "action", "newValue", "createdAt");
