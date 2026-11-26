package com.lazarmarlin.americanatlas;

import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** The web code's handle on MessageWatch: set it up, and notify through it so nothing shows twice. */
@CapacitorPlugin(name = "MessageWatch")
public class MessageWatchPlugin extends Plugin {
    @Override
    public void load() {
        MessageWatch.foreground = true;
        MessageWatch.start(getContext());
        // Opened by tapping a message notification: say which chat.
        if (getActivity() != null) openFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        openFrom(intent);
    }

    private void openFrom(Intent intent) {
        if (intent == null) return;
        String thread = intent.getStringExtra(MessageWatch.EXTRA_THREAD);
        if (thread == null || thread.isEmpty()) return;
        intent.removeExtra(MessageWatch.EXTRA_THREAD);
        JSObject data = new JSObject();
        data.put("thread", thread);
        // Kept until the web code listens, for a cold start.
        notifyListeners("openThread", data, true);
    }

    @Override
    protected void handleOnResume() {
        MessageWatch.foreground = true;
    }

    @Override
    protected void handleOnPause() {
        MessageWatch.foreground = false;
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String url = call.getString("url", "");
        String token = call.getString("token", "");
        if (url.isEmpty() || token.isEmpty()) {
            call.reject("url and token are needed");
            return;
        }
        MessageWatch.configure(getContext(), url, token, strings(call.getArray("seen")));
        call.resolve();
    }

    @PluginMethod
    public void show(PluginCall call) {
        List<String[]> items = new ArrayList<>();
        JSArray list = call.getArray("items");
        if (list != null) {
            for (int i = 0; i < list.length(); i++) {
                JSONObject m = list.optJSONObject(i);
                if (m != null) items.add(new String[] { m.optString("id"), m.optString("title"), m.optString("body"), m.optString("thread") });
            }
        }
        MessageWatch.show(getContext(), items, strings(call.getArray("seen")), call.getInt("likes", -1));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MessageWatch.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void checkNow(PluginCall call) {
        new Thread(() -> {
            MessageWatch.check(getContext());
            call.resolve(new JSObject());
        }).start();
    }

    private static List<String> strings(JSONArray array) {
        List<String> out = new ArrayList<>();
        if (array == null) return out;
        for (int i = 0; i < array.length(); i++) {
            String s = array.optString(i, "");
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }
}
