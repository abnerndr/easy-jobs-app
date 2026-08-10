-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'MATCHED' AFTER 'QUEUED';

-- AlterTable
ALTER TABLE "UserJobSettings" ADD COLUMN "minMatchScore" INTEGER NOT NULL DEFAULT 50;
