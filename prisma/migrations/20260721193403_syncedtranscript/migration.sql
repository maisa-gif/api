-- CreateTable
CREATE TABLE "SyncedTranscript" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveFileName" TEXT NOT NULL,
    "matchedName" TEXT,
    "bitrixContactId" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncedTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncedTranscript_driveFileId_key" ON "SyncedTranscript"("driveFileId");
