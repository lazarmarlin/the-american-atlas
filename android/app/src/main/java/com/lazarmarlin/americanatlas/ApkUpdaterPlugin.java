package com.lazarmarlin.americanatlas;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.pm.PackageInstaller;
import java.io.FileInputStream;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads a new APK of this app and hands it to Android's installer, so an
 * update installs over the old one and keeps everything on the phone.
 *
 * Android asks once for permission to install apps from The American Atlas.
 * The installer then checks the APK is signed with the same key as this app,
 * so only builds from the repository's release key can update it.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    private static final String ALLOWED_PREFIX = "https://github.com/lazarmarlin/the-american-atlas/releases/download/";
    /**
     * One download at a time. The background download and the Update button
     * used to run at once, writing the same file: the progress bar jumped
     * between the two and one failed with "Couldn't save the update".
     */
    private static final Object DOWNLOADING = new Object();
    private static final String PREFS = "atlas-apk-updater";

    @Override
    public void load() {
        // Opened again after an update: the "tap to open" notification has done its job.
        androidx.core.app.NotificationManagerCompat.from(getContext()).cancel(7301);
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject out = new JSObject();
        out.put("allowed", allowed());
        call.resolve(out);
    }

    /** Opens the "Install unknown apps" switch for this app. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith(ALLOWED_PREFIX) || !url.endsWith(".apk")) {
            call.reject("That isn't an Atlas update.");
            return;
        }
        if (!allowed()) {
            call.reject("needs-permission");
            return;
        }
        call.setKeepAlive(true);
        new Thread(() -> {
            try {
                File apk = fetch(url);
                Activity activity = getActivity();
                if (activity == null) throw new Exception("Stay in the app, then try the install again.");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                activity.runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(uri, "application/vnd.android.package-archive");
                        // Without the clip data, Android opens the installer but won't let it read the file.
                        intent.setClipData(ClipData.newRawUri("American Atlas update", uri));
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        activity.startActivity(intent);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject(e.getMessage() == null ? "The installer didn't open." : e.getMessage());
                    } finally {
                        call.setKeepAlive(false);
                    }
                });
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "The download didn't finish." : e.getMessage());
                call.setKeepAlive(false);
            }
        }).start();
    }

    /**
     * Download an update in the background and keep it, without installing.
     * Resolves once the file is complete (progress events meanwhile).
     */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith(ALLOWED_PREFIX) || !url.endsWith(".apk")) {
            call.reject("That isn't an Atlas update.");
            return;
        }
        call.setKeepAlive(true);
        new Thread(() -> {
            try {
                File apk = fetch(url);
                JSObject out = new JSObject();
                out.put("bytes", apk.length());
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "The download didn't finish." : e.getMessage());
            } finally {
                call.setKeepAlive(false);
            }
        }).start();
    }

    /** Whether a downloaded update is waiting to be installed. */
    @PluginMethod
    public void ready(PluginCall call) {
        JSObject out = new JSObject();
        out.put("ready", readyFile().exists());
        call.resolve(out);
    }

    /**
     * Install the downloaded update through Android's package installer.
     * Android 12+ lets an app that installed itself update itself without
     * asking again; otherwise (and the first time) Android shows its one-tap
     * update screen. The app closes while it installs and reopens after
     * (UpdateDoneReceiver).
     */
    @PluginMethod
    public void installReady(PluginCall call) {
        File apk = readyFile();
        if (!apk.exists()) {
            call.reject("No update downloaded.");
            return;
        }
        if (!allowed()) {
            call.reject("needs-permission");
            return;
        }
        new Thread(() -> {
            PackageInstaller.Session session = null;
            try {
                PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(getContext().getPackageName());
                if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                if (Build.VERSION.SDK_INT >= 34) params.setRequestUpdateOwnership(true);
                int id = installer.createSession(params);
                session = installer.openSession(id);
                try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent status = new Intent(getContext(), UpdateStatusReceiver.class);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent sender = PendingIntent.getBroadcast(getContext(), id, status, flags);
                session.commit(sender.getIntentSender());
                session.close();
                session = null;
                call.resolve();
            } catch (Exception e) {
                if (session != null) session.abandon();
                call.reject(e.getMessage() == null ? "The update didn't start." : e.getMessage());
            }
        }).start();
    }

    /** Why the last install didn't go through, if it didn't (then cleared). */
    @PluginMethod
    public void lastError(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(UpdateStatusReceiver.PREFS, android.content.Context.MODE_PRIVATE);
        JSObject out = new JSObject();
        out.put("message", prefs.getString("error", ""));
        out.put("aborted", prefs.getBoolean("aborted", false));
        prefs.edit().remove("error").remove("aborted").apply();
        call.resolve(out);
    }

    /**
     * The update from this address, downloaded (or the copy already downloaded
     * from it). If another download is running, waits for it first: when that
     * was the same update, its file is used as it is.
     */
    private File fetch(String url) throws Exception {
        synchronized (DOWNLOADING) {
            File apk = readyFile();
            android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
            if (apk.exists() && apk.length() > 0 && url.equals(prefs.getString("readyUrl", ""))) return apk;
            File dir = apk.getParentFile();
            if (dir == null || (!dir.exists() && !dir.mkdirs())) throw new Exception("Couldn't make room for the update.");
            File part = new File(dir, "american-atlas.apk.part");
            if (part.exists() && !part.delete()) throw new Exception("Couldn't clear the last download.");
            prefs.edit().remove("readyUrl").apply();
            download(url, part);
            if (apk.exists() && !apk.delete()) throw new Exception("Couldn't replace the last download.");
            if (!part.renameTo(apk)) throw new Exception("Couldn't save the update.");
            prefs.edit().putString("readyUrl", url).apply();
            return apk;
        }
    }

    private File readyFile() {
        return new File(new File(getContext().getCacheDir(), "updates"), "american-atlas-ready.apk");
    }

    private boolean allowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void download(String start, File target) throws Exception {
        String next = start;
        HttpURLConnection conn = null;
        // GitHub sends release files from another host; follow up to 5 redirects.
        for (int hop = 0; hop < 6; hop++) {
            conn = (HttpURLConnection) new URL(next).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("User-Agent", "AmericanAtlas");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || !loc.startsWith("https://")) throw new Exception("The download was redirected somewhere unexpected.");
                next = loc;
                continue;
            }
            if (code != 200) throw new Exception("The download failed (" + code + ").");
            break;
        }
        if (conn == null) throw new Exception("The download didn't start.");
        long total = conn.getContentLengthLong();
        long done = 0;
        int lastPct = -1;
        long lastNote = 0;
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(target)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                int pct = total > 0 ? (int) (done * 100 / total) : -1;
                boolean stepped = pct >= 0 && pct != lastPct;
                boolean tick = pct < 0 && done - lastNote >= 256 * 1024;
                if (stepped || tick) {
                    lastPct = pct;
                    lastNote = done;
                    JSObject p = new JSObject();
                    p.put("percent", pct);
                    p.put("bytes", done);
                    notifyListeners("progress", p);
                }
            }
        } finally {
            conn.disconnect();
        }
        if (total > 0 && done != total) throw new Exception("The download was cut short. Try again.");
    }
}
