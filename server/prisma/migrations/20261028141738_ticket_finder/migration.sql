-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'TICKET_SEARCH';

-- CreateTable
CREATE TABLE "TicketFinderDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TicketFinderDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketFinderDevice_tokenHash_key" ON "TicketFinderDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "TicketFinderDevice_userId_idx" ON "TicketFinderDevice"("userId");

-- AddForeignKey
ALTER TABLE "TicketFinderDevice" ADD CONSTRAINT "TicketFinderDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

