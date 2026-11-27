package com.lazarmarlin.americanatlas;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/**
 * A friend is looking at where you are (a "locate" push from the server, see
 * pingLive in src/lib/live-share.ts). Takes one fresh location and posts it
 * where the location service posts its fixes (/api/track, with this phone's
 * own token), so their map shows where you are now rather than where you
 * were last seen. Also takes the location service out of its quiet spell, so
 * its next fixes go straight up while they keep looking.
 *
 * Only when tracking is on (that's what sharing your live location needs).
 * Runs on the push's own background thread, inside the few seconds Android
 * gives a high-priority push.
 */
final class LiveLocate {
    /** The location plugin's settings (LocationStore in @capgo/background-geolocation). */
    private static final String TRACKING_PREFS = "CapgoBackgroundGeolocationWatcher";
    private static final long WAIT_MS = 12_000;
    /** A last-known location this recent will do if a new one doesn't come in time. */
    private static final long RECENT_MS = 2 * 60_000;

    private LiveLocate() {}

    static void run(Context ctx) {
        Context app = ctx.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(TRACKING_PREFS, Context.MODE_PRIVATE);
        String url = prefs.getString("url", "");
        if (!prefs.getBoolean("enabled", false) || url == null || url.isEmpty()) return;
        // Somebody's looking: the service's next fixes go up straight away.
        prefs.edit().remove("quietUntil").apply();
        if (!allowed(app)) return;
        Location fix = freshFix(app);
        if (fix == null) return;
        try {
            post(url, prefs.getString("headers", "{}"), fix);
        } catch (Exception ignored) {
            // No signal: they keep seeing where you were last.
        }
    }

    private static boolean allowed(Context app) {
        boolean fine = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        return fine || coarse;
    }

    private static Location freshFix(Context app) {
        LocationManager manager = app.getSystemService(LocationManager.class);
        if (manager == null) return null;
        String provider = manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
            ? LocationManager.GPS_PROVIDER
            : manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ? LocationManager.NETWORK_PROVIDER : null;
        Location fix = null;
        if (provider != null) {
            try {
                fix = current(manager, provider);
                // Indoors GPS may not answer in time: the phone network's rough one instead.
                if (fix == null && LocationManager.GPS_PROVIDER.equals(provider) && manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    fix = current(manager, LocationManager.NETWORK_PROVIDER);
                }
            } catch (SecurityException ignored) {
                // Location taken away, or not allowed in the background without the service running.
            }
        }
        if (fix != null) return fix;
        return lastKnown(manager);
    }

    private static Location current(LocationManager manager, String provider) throws SecurityException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Location> found = new AtomicReference<>();
        ExecutorService executor = null;
        LocationListener listener = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            executor = Executors.newSingleThreadExecutor();
            manager.getCurrentLocation(provider, null, executor, (location) -> {
                found.set(location);
                done.countDown();
            });
        } else {
            listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    found.set(location);
                    done.countDown();
                }

                @Override
                public void onStatusChanged(String p, int status, Bundle extras) {}

                @Override
                public void onProviderEnabled(String p) {}

                @Override
                public void onProviderDisabled(String p) {}
            };
            manager.requestSingleUpdate(provider, listener, Looper.getMainLooper());
        }
        try {
            done.await(WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } finally {
            if (executor != null) executor.shutdown();
            if (listener != null) manager.removeUpdates(listener);
        }
        return found.get();
    }

    private static Location lastKnown(LocationManager manager) {
        Location best = null;
        for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
            try {
                Location known = manager.getLastKnownLocation(provider);
                if (known != null && (best == null || known.getTime() > best.getTime())) best = known;
            } catch (SecurityException | IllegalArgumentException ignored) {
                // Not this one.
            }
        }
        return best != null && System.currentTimeMillis() - best.getTime() < RECENT_MS ? best : null;
    }

    private static void post(String url, String headersJson, Location fix) throws Exception {
        JSONObject body = new JSONObject();
        body.put("latitude", fix.getLatitude());
        body.put("longitude", fix.getLongitude());
        body.put("accuracy", fix.hasAccuracy() ? fix.getAccuracy() : JSONObject.NULL);
        body.put("time", fix.getTime());
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            JSONObject headers = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
            for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
                String key = keys.next();
                connection.setRequestProperty(key, headers.optString(key));
            }
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
            connection.getResponseCode();
        } finally {
            connection.disconnect();
        }
    }
}
