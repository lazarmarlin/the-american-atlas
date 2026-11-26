package com.lazarmarlin.americanatlas;

import android.content.Intent;
import com.capgo.capacitor_background_geolocation.BackgroundGeolocationService;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The tracking notification's own lines (today's places, the next county) and
 * its buttons: "I'm here" opens the app on the I'm here sheet, "Stop tracking"
 * stops the location service and tells the web code to turn tracking off.
 */
@CapacitorPlugin(name = "TrackNote")
public class TrackNotePlugin extends Plugin {
    @Override
    public void load() {
        BackgroundGeolocationService.stoppedListener = () -> {
            // Heard here, so the flag isn't left for the next time tracking starts.
            BackgroundGeolocationService.takeStoppedFromNotification(getContext());
            notifyListeners("stopped", new JSObject(), true);
        };
        if (getActivity() != null) actionFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnDestroy() {
        BackgroundGeolocationService.stoppedListener = null;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        actionFrom(intent);
    }

    private void actionFrom(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(BackgroundGeolocationService.EXTRA_APP_ACTION);
        if (action == null || action.isEmpty()) return;
        intent.removeExtra(BackgroundGeolocationService.EXTRA_APP_ACTION);
        JSObject data = new JSObject();
        data.put("action", action);
        // Kept until the web code listens, for a cold start.
        notifyListeners("action", data, true);
    }

    @PluginMethod
    public void set(PluginCall call) {
        BackgroundGeolocationService.setNote(getContext(), call.getString("title", ""), call.getString("text", ""));
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        BackgroundGeolocationService.setNote(getContext(), null, null);
        call.resolve();
    }

    /** Live-trail friends changed: the location service posts its next fix instead of keeping it on the phone. */
    @PluginMethod
    public void postSoon(PluginCall call) {
        BackgroundGeolocationService.postSoon(getContext());
        call.resolve();
    }

    /** Whether "Stop tracking" was tapped on the notification since the app last asked. */
    @PluginMethod
    public void takeStopped(PluginCall call) {
        JSObject out = new JSObject();
        out.put("stopped", BackgroundGeolocationService.takeStoppedFromNotification(getContext()));
        call.resolve(out);
    }
}
