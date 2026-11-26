package com.lazarmarlin.americanatlas;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** Saves a photo into the phone's gallery, in Pictures/American Atlas (src/lib/save-photo.ts). */
@CapacitorPlugin(name = "Gallery")
public class GalleryPlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data", "");
        String name = call.getString("name", "atlas-photo.jpg");
        if (data == null || data.isEmpty()) {
            call.reject("No photo");
            return;
        }
        int comma = data.indexOf(',');
        if (data.startsWith("data:") && comma > 0) data = data.substring(comma + 1);
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("That photo couldn't be read");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10 and up: no permission needed to add to the gallery.
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/American Atlas");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new Exception("The gallery didn't take it");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new Exception("The gallery didn't take it");
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "American Atlas");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Couldn't make the folder");
                File file = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, new String[] { "image/jpeg" }, null);
            }
            JSObject ok = new JSObject();
            ok.put("saved", true);
            call.resolve(ok);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Couldn't save it" : e.getMessage());
        }
    }
}
