-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "accessToken" TEXT;
ALTER TABLE "Integration" ADD COLUMN "lastSyncAt" DATETIME;
ALTER TABLE "Integration" ADD COLUMN "metadata" TEXT;
ALTER TABLE "Integration" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Integration" ADD COLUMN "tokenExpiresAt" DATETIME;

-- CreateTable
CREATE TABLE "SyncedAppointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cnnAppointmentId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "sourceUpdatedAt" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncedAppointment_cnnAppointmentId_key" ON "SyncedAppointment"("cnnAppointmentId");
