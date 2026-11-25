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

    /** Keep the screen on, and lock the phone sideways, for the driving view. */
    @PluginMethod
    public void driveScreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
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
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            activity.setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            call.resolve();
        });
    }
}
