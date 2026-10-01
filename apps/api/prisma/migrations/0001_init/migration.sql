-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AlarmKind" AS ENUM ('below', 'above');

-- CreateEnum
CREATE TYPE "AlarmAction" AS ENUM ('fired', 'cleared');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phoneE164" TEXT,
    "telegramChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3),
    "apiBaseUrl" TEXT,
    "pendingUnixTime" BIGINT,
    "configRev" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalSec" INTEGER NOT NULL DEFAULT 10,
    "offset" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gain" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "bValue" DOUBLE PRECISION NOT NULL DEFAULT 3950,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "channel" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "tempC" DOUBLE PRECISION,
    "adcRaw" INTEGER NOT NULL,
    "rOhm" DOUBLE PRECISION,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alarm" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "channel" INTEGER NOT NULL,
    "kind" "AlarmKind" NOT NULL,
    "thresholdC" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hysteresis" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "cooldownSec" INTEGER NOT NULL DEFAULT 300,
    "notifySms" BOOLEAN NOT NULL DEFAULT false,
    "notifyTelegram" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alarm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlarmEvent" (
    "id" TEXT NOT NULL,
    "alarmId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "channel" INTEGER NOT NULL,
    "kind" "AlarmKind" NOT NULL,
    "thresholdC" DOUBLE PRECISION NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "action" "AlarmAction" NOT NULL,
    "notifySms" BOOLEAN NOT NULL DEFAULT false,
    "notifyTelegram" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AlarmEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_deviceId_index_key" ON "Channel"("deviceId", "index");

-- CreateIndex
CREATE INDEX "Sample_deviceId_ts_idx" ON "Sample"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "Sample_deviceId_channel_ts_idx" ON "Sample"("deviceId", "channel", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_deviceId_ts_channel_key" ON "Sample"("deviceId", "ts", "channel");

-- CreateIndex
CREATE INDEX "Alarm_deviceId_channel_idx" ON "Alarm"("deviceId", "channel");

-- CreateIndex
CREATE INDEX "AlarmEvent_deviceId_ts_idx" ON "AlarmEvent"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "AlarmEvent_alarmId_ts_idx" ON "AlarmEvent"("alarmId", "ts");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_deviceId_channel_fkey" FOREIGN KEY ("deviceId", "channel") REFERENCES "Channel"("deviceId", "index") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlarmEvent" ADD CONSTRAINT "AlarmEvent_alarmId_fkey" FOREIGN KEY ("alarmId") REFERENCES "Alarm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlarmEvent" ADD CONSTRAINT "AlarmEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
