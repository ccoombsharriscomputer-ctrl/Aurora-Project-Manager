-- CreateTable
CREATE TABLE "UserSoftwareLineGrant" (
    "userId" TEXT NOT NULL,
    "softwareLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSoftwareLineGrant_pkey" PRIMARY KEY ("userId","softwareLineId")
);

-- AddForeignKey
ALTER TABLE "UserSoftwareLineGrant" ADD CONSTRAINT "UserSoftwareLineGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSoftwareLineGrant" ADD CONSTRAINT "UserSoftwareLineGrant_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
