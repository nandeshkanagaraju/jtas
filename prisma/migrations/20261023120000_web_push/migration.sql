ALTER TYPE "NotifChannel" ADD VALUE 'PUSH';
CREATE TABLE "PushSubscription" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "endpoint" TEXT NOT NULL,
 "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL, "sessionFamilyId" TEXT NOT NULL,
 "locale" TEXT NOT NULL DEFAULT 'en', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
CREATE INDEX "PushSubscription_sessionFamilyId_idx" ON "PushSubscription"("sessionFamilyId");
CREATE TABLE "PushDelivery" (
 "id" TEXT NOT NULL, "notificationId" TEXT NOT NULL, "subscriptionId" TEXT NOT NULL,
 "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushDelivery_notificationId_subscriptionId_key" ON "PushDelivery"("notificationId", "subscriptionId");
