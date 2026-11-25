package com.lazarmarlin.americanatlas;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Saves the home-screen widget's numbers and redraws it (src/lib/widget.ts). */
@CapacitorPlugin(name = "AtlasWidget")
public class WidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        SharedPreferences.Editor edit = context.getSharedPreferences(AtlasWidget.PREFS, Context.MODE_PRIVATE).edit();
        edit.putString("day", call.getString("day", ""));
        edit.putInt("today", call.getInt("today", 0));
        edit.putInt("monthPoints", call.getInt("monthPoints", 0));
        edit.putInt("places", call.getInt("places", 0));
        edit.putBoolean("tracking", Boolean.TRUE.equals(call.getBoolean("tracking", false)));
        String last = call.getString("last", "");
        edit.putString("last", last == null ? "" : last);
        edit.apply();
        AtlasWidget.refresh(context);
        call.resolve();
    }
}
