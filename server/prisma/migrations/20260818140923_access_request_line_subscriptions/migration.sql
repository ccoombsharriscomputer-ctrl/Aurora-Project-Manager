-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessRequestNotifyAllLines" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AccessRequestLineSubscription" (
    "userId" TEXT NOT NULL,
    "softwareLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRequestLineSubscription_pkey" PRIMARY KEY ("userId","softwareLineId")
);

-- AddForeignKey
ALTER TABLE "AccessRequestLineSubscription" ADD CONSTRAINT "AccessRequestLineSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestLineSubscription" ADD CONSTRAINT "AccessRequestLineSubscription_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
