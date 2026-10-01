-- CreateEnum
CREATE TYPE "LastSeenVia" AS ENUM ('wifi', 'local');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "lastSeenVia" "LastSeenVia";
