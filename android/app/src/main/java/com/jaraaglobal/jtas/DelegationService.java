package com.jaraaglobal.jtas;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;

/** App-branded alerts; the inherited Binder still verifies the browser's token. */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    private static final String CHANNEL_ID = "jaraa_work_updates";

    private NotificationManager manager() {
        return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private void prepareChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                    getString(R.string.work_updates_channel), NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(getString(R.string.work_updates_description));
            channel.enableVibration(true);
            channel.setShowBadge(true);
            // Recreating an existing channel preserves the user's sound/importance settings.
            manager().createNotificationChannel(channel);
        }
    }

    @Override
    public boolean onAreNotificationsEnabled(@NonNull String channelName) {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return false;
        prepareChannel();
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || manager().getNotificationChannel(CHANNEL_ID).getImportance()
                != NotificationManager.IMPORTANCE_NONE;
    }

    @Override
    public boolean onNotifyNotificationWithChannel(@NonNull String tag, int id,
            @NonNull Notification notification, @NonNull String channelName) {
        // Explicit permission guard also makes the Android 13+ requirement visible to lint.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return false;
        if (!onAreNotificationsEnabled(channelName)) return false;
        Notification.Builder builder = Notification.Builder.recoverBuilder(this, notification)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setAutoCancel(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setChannelId(CHANNEL_ID);
        } else {
            builder.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        // Preserve the browser-supplied click intent, tag, id and account deep link.
        manager().notify(tag, id, builder.build());
        return true;
    }
}
