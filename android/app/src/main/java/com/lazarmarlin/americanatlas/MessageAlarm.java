package com.lazarmarlin.americanatlas;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The every-minute message check while tracking (see MessageWatch). An alarm
 * rather than a timer: a timer only counts while the phone is awake, and the
 * location service no longer keeps it awake between fixes.
 */
public class MessageAlarm extends BroadcastReceiver {
    static PendingIntent intent(Context app) {
        Intent i = new Intent(app, MessageAlarm.class).setAction("com.lazarmarlin.americanatlas.CHECK_MESSAGES");
        return PendingIntent.getBroadcast(app, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        final Context app = ctx.getApplicationContext();
        MessageWatch.scheduleNext(app);
        if (MessageWatch.foreground || !MessageWatch.configured(app)) return;
        // Keeps the phone awake until the check is done (both timeouts are 15 s).
        final PendingResult done = goAsync();
        new Thread(() -> {
            try {
                MessageWatch.check(app);
            } finally {
                done.finish();
            }
        }, "atlas-messages").start();
    }
}
