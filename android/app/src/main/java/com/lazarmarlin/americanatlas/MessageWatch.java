package com.lazarmarlin.americanatlas;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phone notifications for new messages and thumbs-up, checked natively.
 *
 * The web code's own check pauses once the app is in the background, so on
 * its own it only notified while the app was open. This checks /api/notify
 * every minute while tracking is on (an alarm, MessageAlarm, so it still runs
 * while the phone sleeps between location fixes), and every 15 minutes
 * through WorkManager otherwise. While the app is on screen the web code notifies instead (it knows
 * which chat is open), through show(), so both share one list of messages
 * already notified and nothing shows twice.
 */
final class MessageWatch {
    static final String CHANNEL = "messages";
    private static final String PREFS = "atlas.message-watch";
    private static final String WORK = "atlas-message-check";
    private static final long EVERY_MS = 60_000;
    /** Parked (GPS off) for this long with the app closed: check every 3 minutes instead (saves battery overnight). */
    private static final long PARKED_SLOW_AFTER_MS = 20 * 60_000;
    private static final long PARKED_EVERY_MS = 3 * 60_000;
    private static final int KEEP_SEEN = 200;

    /** The app is on screen (set by MessageWatchPlugin). */
    static volatile boolean foreground = false;

    /** The location plugin's own settings (LocationStore in @capgo/background-geolocation). */
    private static final String TRACKING_PREFS = "CapgoBackgroundGeolocationWatcher";

    private MessageWatch() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean configured(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return !p.getString("url", "").isEmpty() && !p.getString("token", "").isEmpty();
    }

    static synchronized void configure(Context ctx, String url, String token, List<String> seen) {
        Context app = ctx.getApplicationContext();
        SharedPreferences p = prefs(app);
        LinkedHashSet<String> ids = seenIds(p);
        ids.addAll(seen);
        p.edit().putString("url", url).putString("token", token).putString("seen", join(ids)).apply();
        start(app);
    }

    /** Chats that should not buzz ("friend:<id>", "group:<id>"). */
    static synchronized void setQuiet(Context ctx, List<String> quiet) {
        prefs(ctx.getApplicationContext()).edit().putString("quiet", String.join("\n", quiet)).apply();
    }

    static synchronized void stop(Context ctx) {
        Context app = ctx.getApplicationContext();
        prefs(app).edit().remove("token").apply();
        WorkManager.getInstance(app).cancelUniqueWork(WORK);
        AlarmManager alarms = app.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(MessageAlarm.intent(app));
    }

    /** Tracking is on (the location service is running and posting fixes). */
    static boolean tracking(Context ctx) {
        SharedPreferences p = ctx.getApplicationContext().getSharedPreferences(TRACKING_PREFS, Context.MODE_PRIVATE);
        return p.getBoolean("enabled", false) && p.getString("url", null) != null;
    }

    /**
     * The next minute's check. Only while tracking or on screen: otherwise the
     * 15-minute WorkManager check is enough, and an alarm would wake the phone.
     */
    static void scheduleNext(Context ctx) {
        Context app = ctx.getApplicationContext();
        if (!configured(app) || !(foreground || tracking(app))) return;
        AlarmManager alarms = app.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        long every = EVERY_MS;
        long parkedSince = com.capgo.capacitor_background_geolocation.BackgroundGeolocationService.parkedSinceMs();
        if (!foreground && parkedSince > 0 && SystemClock.elapsedRealtime() - parkedSince > PARKED_SLOW_AFTER_MS) every = PARKED_EVERY_MS;
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + every, MessageAlarm.intent(app));
    }

    /** Make sure both checks are running (safe to call often). */
    static synchronized void start(Context ctx) {
        final Context app = ctx.getApplicationContext();
        if (!configured(app)) return;
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(MessageCheckWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(online)
            .build();
        WorkManager.getInstance(app).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, work);
        scheduleNext(app);
    }

    /** Ask the server what's new and notify anything not notified yet. */
    static void check(Context ctx) {
        Context app = ctx.getApplicationContext();
        SharedPreferences p = prefs(app);
        String url = p.getString("url", "");
        String token = p.getString("token", "");
        if (url.isEmpty() || token.isEmpty()) return;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/json");
            int status = conn.getResponseCode();
            if (status == 401) {
                // Signed out, or the token was replaced: the app sets a new one when it opens.
                p.edit().remove("token").apply();
                return;
            }
            if (status != 200) return;
            StringBuilder text = new StringBuilder();
            try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = in.readLine()) != null) text.append(line);
            }
            JSONObject body = new JSONObject(text.toString());
            JSONArray list = body.optJSONArray("messages");
            List<String[]> items = new ArrayList<>();
            List<String> all = new ArrayList<>();
            if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    JSONObject m = list.getJSONObject(i);
                    items.add(new String[] { m.optString("id"), m.optString("title"), m.optString("body"), m.optString("thread") });
                    all.add(m.optString("id"));
                }
            }
            show(app, items, all, body.optInt("likes", -1));
        } catch (Exception ignored) {
            // Offline or the server is busy: next time.
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * Notify the items (newest first: {id, title, body}) not notified yet,
     * then remember every id in seen. A thumbs-up count above the last one
     * gets its own notification.
     */
    static synchronized void show(Context ctx, List<String[]> items, List<String> seen, int likes) {
        Context app = ctx.getApplicationContext();
        SharedPreferences p = prefs(app);
        LinkedHashSet<String> ids = seenIds(p);
        List<String[]> fresh = new ArrayList<>();
        for (String[] item : items) if (!item[0].isEmpty() && !ids.contains(item[0])) fresh.add(item);
        for (int i = Math.min(fresh.size(), 3) - 1; i >= 0; i--) {
            String[] item = fresh.get(i);
            String thread = item.length > 3 ? item[3] : "";
            if (quietIds(p).contains(thread)) continue;
            post(app, "m:" + item[0], item[1], item[2], thread);
        }
        for (String[] item : items) ids.add(item[0]);
        ids.addAll(seen);
        SharedPreferences.Editor edit = p.edit().putString("seen", join(ids));
        if (likes >= 0) {
            int before = p.getInt("likes", -1);
            if (before >= 0 && likes > before) post(app, "likes:" + likes, "New thumbs-up", "A friend liked one of your badges or check-ins.", "likes");
            edit.putInt("likes", likes);
        }
        edit.apply();
    }

    /** Extra on the notification's tap: which chat to open ("friend:<id>", "group:<id>" or "likes"). */
    static final String EXTRA_THREAD = "atlasThread";

    private static void post(Context ctx, String key, String title, String body, String thread) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = ctx.getSystemService(NotificationManager.class);
            if (manager != null && manager.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel channel = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Texts and thumbs-up from friends.");
                manager.createNotificationChannel(channel);
            }
        }
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent tap = null;
        if (open != null) {
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (thread != null && !thread.isEmpty()) open.putExtra(EXTRA_THREAD, thread);
            tap = PendingIntent.getActivity(ctx, key.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }
        NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_atlas)
            .setColor(0xFFE2B15A)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true);
        if (tap != null) n.setContentIntent(tap);
        try {
            NotificationManagerCompat.from(ctx).notify(key.hashCode(), n.build());
        } catch (SecurityException ignored) {
            // Notifications turned off.
        }
    }

    private static LinkedHashSet<String> quietIds(SharedPreferences p) {
        String raw = p.getString("quiet", "");
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        if (!raw.isEmpty()) ids.addAll(Arrays.asList(raw.split("\n")));
        return ids;
    }

    private static LinkedHashSet<String> seenIds(SharedPreferences p) {
        String raw = p.getString("seen", "");
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        if (!raw.isEmpty()) ids.addAll(Arrays.asList(raw.split("\n")));
        return ids;
    }

    private static String join(LinkedHashSet<String> ids) {
        List<String> list = new ArrayList<>(ids);
        if (list.size() > KEEP_SEEN) list = list.subList(list.size() - KEEP_SEEN, list.size());
        return String.join("\n", list);
    }
}
