-- AlterEnum
ALTER TYPE "JobSource" ADD VALUE 'LINKEDIN';

-- CreateEnum
CREATE TYPE "JobBoardProvider" AS ENUM ('INDEED', 'LINKEDIN');

-- CreateTable
CREATE TABLE "JobBoardConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "JobBoardProvider" NOT NULL,
    "sessionPath" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "JobBoardConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobBoardConnection_userId_provider_key" ON "JobBoardConnection"("userId", "provider");

-- AddForeignKey
ALTER TABLE "JobBoardConnection" ADD CONSTRAINT "JobBoardConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
