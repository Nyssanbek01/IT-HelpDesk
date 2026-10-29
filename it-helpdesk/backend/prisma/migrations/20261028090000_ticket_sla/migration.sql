ALTER TABLE "Ticket"
  ADD COLUMN "responseDueAt" TIMESTAMP(3),
  ADD COLUMN "resolutionDueAt" TIMESTAMP(3),
  ADD COLUMN "firstRespondedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "slaTrackedFromCreation" BOOLEAN NOT NULL DEFAULT false;

-- Only deadlines are reconstructible. Historical action timestamps remain null.
UPDATE "Ticket" SET
  "responseDueAt" = "createdAt" + CASE "priority"
    WHEN 'high' THEN INTERVAL '15 minutes' WHEN 'medium' THEN INTERVAL '60 minutes' WHEN 'low' THEN INTERVAL '240 minutes' END,
  "resolutionDueAt" = "createdAt" + CASE "priority"
    WHEN 'high' THEN INTERVAL '4 hours' WHEN 'medium' THEN INTERVAL '8 hours' WHEN 'low' THEN INTERVAL '24 hours' END;

ALTER TABLE "Ticket" ALTER COLUMN "slaTrackedFromCreation" SET DEFAULT true;
CREATE INDEX "Ticket_status_resolutionDueAt_idx" ON "Ticket"("status", "resolutionDueAt");
CREATE INDEX "Ticket_status_responseDueAt_idx" ON "Ticket"("status", "responseDueAt");

CREATE TABLE "TicketSlaEvent" (
  "id" SERIAL NOT NULL,
  "ticketId" INTEGER NOT NULL,
  "stage" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketSlaEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketSlaEvent_ticketId_stage_phase_key" ON "TicketSlaEvent"("ticketId", "stage", "phase");
ALTER TABLE "TicketSlaEvent" ADD CONSTRAINT "TicketSlaEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
