package com.lazarmarlin.americanatlas;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.io.File;

/**
 * Runs once right after the app updated itself. Installing closed the app, so
 * this tries to open it again (Android may not allow that from here) and
 * leaves a notification to tap either way, so tracking picks back up.
 */
public class UpdateDoneReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "updates";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        // The installed file isn't needed any more.
        File ready = new File(new File(context.getCacheDir(), "updates"), "american-atlas-ready.apk");
        if (ready.exists()) ready.delete();
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) return;
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(open);
        } catch (Exception ignored) {
            // Not allowed from the background on newer Android: the notification below does it.
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null && manager.getNotificationChannel(CHANNEL) == null) {
                manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_DEFAULT));
            }
        }
        PendingIntent tap = PendingIntent.getActivity(context, 7, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String version = "";
        try {
            version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            // Just leave it out.
        }
        NotificationCompat.Builder n = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_atlas)
            .setColor(0xFFE2B15A)
            .setContentTitle("The American Atlas updated")
            .setContentText("Tap to open" + (version == null || version.isEmpty() ? "" : " · " + version) + ". Tracking picks back up.")
            .setAutoCancel(true)
            .setTimeoutAfter(6 * 60 * 60 * 1000L)
            .setContentIntent(tap);
        try {
            NotificationManagerCompat.from(context).notify(7301, n.build());
        } catch (SecurityException ignored) {
            // Notifications are off.
        }
    }
}
