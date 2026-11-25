-- CreateEnum
CREATE TYPE "SignInRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'USED', 'EXPIRED');

-- CreateTable
CREATE TABLE "SignInRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SignInRequestStatus" NOT NULL DEFAULT 'PENDING',
    "pollHash" TEXT NOT NULL,
    "linkHash" TEXT,
    "rememberDevice" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "linkExpiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignInRequest_pollHash_key" ON "SignInRequest"("pollHash");

-- CreateIndex
CREATE UNIQUE INDEX "SignInRequest_linkHash_key" ON "SignInRequest"("linkHash");

-- CreateIndex
CREATE INDEX "SignInRequest_status_createdAt_idx" ON "SignInRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SignInRequest_userId_status_idx" ON "SignInRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "SignInRequest" ADD CONSTRAINT "SignInRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
