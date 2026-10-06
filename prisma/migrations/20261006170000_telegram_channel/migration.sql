-- Telegram as a second channel. Email rows are unchanged.
-- A chat id on the user is the only address. No chat id means no Telegram row.

ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

ALTER TABLE "AuditLog" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'WEB';

CREATE TABLE "TelegramLinkCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramLinkCode_code_key" ON "TelegramLinkCode"("code");
CREATE INDEX "TelegramLinkCode_userId_idx" ON "TelegramLinkCode"("userId");

ALTER TABLE "TelegramLinkCode"
  ADD CONSTRAINT "TelegramLinkCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TelegramPending" (
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subtaskId" TEXT NOT NULL,
    "deadline" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramPending_pkey" PRIMARY KEY ("chatId")
);

CREATE INDEX "TelegramPending_userId_idx" ON "TelegramPending"("userId");

ALTER TABLE "TelegramPending"
  ADD CONSTRAINT "TelegramPending_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "NotifChannel" ADD VALUE 'TELEGRAM';
