package com.lazarmarlin.americanatlas;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Home-screen widget: places today, points this month, and whether tracking
 * is on. The app writes the numbers (WidgetPlugin.java, src/lib/widget.ts);
 * the widget only reads them, so it costs nothing while the app is closed.
 */
public class AtlasWidget extends AppWidgetProvider {
    static final String PREFS = "atlas_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(context));
    }

    /** Redraw every placed widget (after the app saves new numbers). */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AtlasWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews views = views(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    static RemoteViews views(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String month = today.substring(0, 7);
        boolean sameDay = today.equals(prefs.getString("day", ""));
        boolean sameMonth = month.equals(prefs.getString("day", "").length() >= 7 ? prefs.getString("day", "").substring(0, 7) : "");
        // Numbers from yesterday (the app hasn't run today) read as zero for today.
        int todayNew = sameDay ? prefs.getInt("today", 0) : 0;
        int monthPoints = sameMonth ? prefs.getInt("monthPoints", 0) : 0;
        int places = prefs.getInt("places", 0);
        boolean tracking = prefs.getBoolean("tracking", false);
        String last = sameDay ? prefs.getString("last", "") : "";
        NumberFormat nf = NumberFormat.getIntegerInstance(Locale.getDefault());

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_atlas);
        views.setTextViewText(R.id.widget_today, nf.format(todayNew));
        views.setTextViewText(R.id.widget_today_label, todayNew == 1 ? "new place today" : "new places today");
        views.setTextViewText(R.id.widget_points, nf.format(monthPoints) + " pts this month");
        views.setTextViewText(R.id.widget_places, nf.format(places) + " on the map");
        views.setTextViewText(R.id.widget_tracking, tracking ? "● Tracking on" : "○ Tracking off");
        views.setTextColor(R.id.widget_tracking, tracking ? 0xFFE2B15A : 0xFF8A8C80);
        if (last == null || last.isEmpty()) {
            views.setTextViewText(R.id.widget_last, places == 0 ? "Open the app to start" : "Nothing new yet today");
        } else {
            views.setTextViewText(R.id.widget_last, "Latest: " + last);
        }

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, tap);
        return views;
    }
}
