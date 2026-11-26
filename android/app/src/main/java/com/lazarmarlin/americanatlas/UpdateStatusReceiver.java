package com.lazarmarlin.americanatlas;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * Hears back from Android's package installer about an update. When Android
 * wants a tap (the first self-update, or an older Android), it opens its
 * update screen; a failure is kept for the app to show.
 */
public class UpdateStatusReceiver extends BroadcastReceiver {
    static final String PREFS = "atlas.update";

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                } catch (Exception ignored) {
                    // Opened from the app next time.
                }
            }
            return;
        }
        if (status != PackageInstaller.STATUS_SUCCESS) {
            boolean aborted = status == PackageInstaller.STATUS_FAILURE_ABORTED;
            String message = aborted ? "" : intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            if (!aborted && (message == null || message.isEmpty())) message = "The update didn't install.";
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("error", message).putBoolean("aborted", aborted).apply();
            // A file Android refused won't install next time either: fetch it again.
            if (!aborted) {
                java.io.File apk = new java.io.File(new java.io.File(context.getCacheDir(), "updates"), "american-atlas-ready.apk");
                if (apk.exists()) apk.delete();
            }
        }
    }
}
