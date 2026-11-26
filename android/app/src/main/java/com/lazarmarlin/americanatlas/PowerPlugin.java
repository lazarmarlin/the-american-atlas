package com.lazarmarlin.americanatlas;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Battery optimization. Android may pause an app's location updates with the
 * screen off to save power; letting The American Atlas run unrestricted keeps
 * tracking and live sharing going. Android shows its own yes/no prompt.
 */
@CapacitorPlugin(name = "Power")
public class PowerPlugin extends Plugin {

    /** Battery level (0–100) and whether it's charging, for tracking that eases off when low. */
    @PluginMethod
    public void battery(PluginCall call) {
        JSObject out = new JSObject();
        Intent state = getContext().registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (state == null) {
            call.reject("No battery info");
            return;
        }
        int level = state.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
        int scale = state.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100);
        int status = state.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
        out.put("level", level < 0 || scale <= 0 ? -1 : Math.round(level * 100f / scale));
        // Plugged in counts even when the phone holds the charge at its limit ("not charging" at 80%).
        boolean plugged = state.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0) != 0;
        out.put("charging", plugged || status == android.os.BatteryManager.BATTERY_STATUS_CHARGING || status == android.os.BatteryManager.BATTERY_STATUS_FULL);
        call.resolve(out);
    }

    @PluginMethod
    public void status(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject out = new JSObject();
        out.put("unrestricted", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(out);
    }

    @PluginMethod
    public void requestUnrestricted(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            // Some phones don't offer the prompt; open the battery list instead.
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    /** Whether notifications are on for the app, and which of its channels are switched off. */
    @PluginMethod
    public void notifications(PluginCall call) {
        JSObject out = new JSObject();
        out.put("enabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        JSArray off = new JSArray();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                for (NotificationChannel channel : nm.getNotificationChannels()) {
                    if (channel.getImportance() == NotificationManager.IMPORTANCE_NONE) off.put(String.valueOf(channel.getName()));
                }
            }
        }
        out.put("channelsOff", off);
        call.resolve(out);
    }

    /** Android's notification settings for this app. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Online, and on a connection that doesn't count against a data plan (Wi-Fi), for saving maps ahead. */
    @PluginMethod
    public void network(PluginCall call) {
        JSObject out = new JSObject();
        boolean online = false;
        boolean unmetered = false;
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
            android.net.Network network = cm == null ? null : cm.getActiveNetwork();
            android.net.NetworkCapabilities caps = network == null ? null : cm.getNetworkCapabilities(network);
            if (caps != null) {
                online = caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
                unmetered = online && !cm.isActiveNetworkMetered();
            }
        } catch (Exception ignore) {
            // Unknown: treated as offline, so nothing big downloads.
        }
        out.put("online", online);
        out.put("unmetered", unmetered);
        call.resolve(out);
    }

    /** Keep the screen on (unless awake is false), and lock the phone sideways, for the driving view. */
    @PluginMethod
    public void driveScreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        boolean awake = on && !Boolean.FALSE.equals(call.getBoolean("awake", true));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (activity.isDestroyed()) {
                call.resolve();
                return;
            }
            if (awake) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            activity.setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            call.resolve();
        });
    }
}
