package com.lazarmarlin.americanatlas;

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
        call.setKeepAlive(false);
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Couldn't make room for the update.");
                File apk = new File(dir, "american-atlas.apk");
                download(url, apk);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "The download didn't finish." : e.getMessage());
            }
        }).start();
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
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
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
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(target)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int pct = (int) (done * 100 / total);
                    if (pct != lastPct) {
                        lastPct = pct;
                        JSObject p = new JSObject();
                        p.put("percent", pct);
                        notifyListeners("progress", p);
                    }
                }
            }
        } finally {
            conn.disconnect();
        }
    }
}
