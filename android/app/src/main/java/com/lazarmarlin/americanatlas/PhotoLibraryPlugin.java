package com.lazarmarlin.americanatlas;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Reads the phone's own photo library, location included.
 *
 * Photos handed to the web view through the normal file picker arrive with
 * their location removed (Android's photo picker always strips it, and other
 * pickers do unless the app may read media locations). This plugin asks for
 * photo access plus "media location", reads each photo's original file, and
 * returns where and when it was taken, so the app can match photos to places.
 */
@CapacitorPlugin(
    name = "PhotoLibrary",
    permissions = {
        @Permission(alias = "images", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_MEDIA_LOCATION }),
    }
)
public class PhotoLibraryPlugin extends Plugin {

    private String readAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "images" : "storage";
    }

    private boolean canRead() {
        if (getPermissionState(readAlias()) == PermissionState.GRANTED) return true;
        // Android 14+ "Select photos": the app may read only the photos the person chose.
        if (Build.VERSION.SDK_INT >= 34) {
            return getContext().checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }
        return false;
    }

    private boolean canLocate() {
        return Build.VERSION.SDK_INT < 29 || getPermissionState("location") == PermissionState.GRANTED;
    }

    /** Recent photos that have a location: newest first. */
    @PluginMethod
    public void scan(PluginCall call) {
        if (!canRead() || !canLocate()) {
            String[] aliases = Build.VERSION.SDK_INT >= 29 ? new String[] { readAlias(), "location" } : new String[] { readAlias() };
            requestPermissionForAliases(aliases, call, "afterPermission");
            return;
        }
        runScan(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (!canRead()) {
            call.reject("no-photo-access");
            return;
        }
        if (!canLocate()) {
            call.reject("no-location-access");
            return;
        }
        runScan(call);
    }

    private void runScan(PluginCall call) {
        final long since = call.getLong("since", 0L);
        final int limit = Math.max(1, Math.min(call.getInt("limit", 300), 1000));
        new Thread(() -> {
            JSArray found = new JSArray();
            int checked = 0;
            int noLocation = 0;
            ContentResolver resolver = getContext().getContentResolver();
            Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            String[] columns = { MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_ADDED };
            String where = MediaStore.Images.Media.DATE_ADDED + " >= ?";
            String[] args = { String.valueOf(since / 1000L) };
            String order = MediaStore.Images.Media.DATE_ADDED + " DESC";
            try (Cursor cursor = resolver.query(collection, columns, where, args, order)) {
                if (cursor != null) {
                    int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    int takenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN);
                    int addedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED);
                    while (cursor.moveToNext() && checked < limit) {
                        checked++;
                        long id = cursor.getLong(idCol);
                        Uri uri = ContentUris.withAppendedId(collection, id);
                        double[] latLon = location(resolver, uri);
                        if (latLon == null) {
                            noLocation++;
                            continue;
                        }
                        long taken = cursor.getLong(takenCol);
                        if (taken <= 0) taken = cursor.getLong(addedCol) * 1000L;
                        JSObject row = new JSObject();
                        row.put("uri", uri.toString());
                        row.put("lat", latLon[0]);
                        row.put("lon", latLon[1]);
                        row.put("takenAt", taken);
                        found.put(row);
                    }
                }
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Couldn't read your photos." : e.getMessage());
                return;
            }
            JSObject out = new JSObject();
            out.put("photos", found);
            out.put("checked", checked);
            out.put("noLocation", noLocation);
            call.resolve(out);
        }).start();
    }

    private double[] location(ContentResolver resolver, Uri uri) {
        Uri original = Build.VERSION.SDK_INT >= 29 ? MediaStore.setRequireOriginal(uri) : uri;
        try (InputStream in = resolver.openInputStream(original)) {
            if (in == null) return null;
            ExifInterface exif = new ExifInterface(in);
            float[] ll = new float[2];
            if (!exif.getLatLong(ll)) return null;
            if (ll[0] == 0f && ll[1] == 0f) return null;
            return new double[] { ll[0], ll[1] };
        } catch (Exception e) {
            return null;
        }
    }

    /** A photo as a JPEG data URL no larger than `max` pixels on its long side, turned upright. */
    @PluginMethod
    public void load(PluginCall call) {
        final String uriText = call.getString("uri", "");
        final int max = Math.max(48, Math.min(call.getInt("max", 720), 2048));
        final int quality = Math.max(30, Math.min(call.getInt("quality", 72), 95));
        if (uriText == null || !uriText.startsWith("content://media/")) {
            call.reject("That isn't a photo on this phone.");
            return;
        }
        new Thread(() -> {
            try {
                Uri uri = Uri.parse(uriText);
                ContentResolver resolver = getContext().getContentResolver();
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                try (InputStream in = resolver.openInputStream(uri)) {
                    BitmapFactory.decodeStream(in, null, bounds);
                }
                int sample = 1;
                while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= max) sample *= 2;
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = sample;
                Bitmap bitmap;
                try (InputStream in = resolver.openInputStream(uri)) {
                    bitmap = BitmapFactory.decodeStream(in, null, opts);
                }
                if (bitmap == null) throw new Exception("Couldn't open that photo.");
                int orientation = ExifInterface.ORIENTATION_NORMAL;
                try (InputStream in = resolver.openInputStream(uri)) {
                    if (in != null) orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                }
                float scale = Math.min(1f, (float) max / Math.max(bitmap.getWidth(), bitmap.getHeight()));
                Matrix matrix = new Matrix();
                matrix.postScale(scale, scale);
                if (orientation == ExifInterface.ORIENTATION_ROTATE_90) matrix.postRotate(90);
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) matrix.postRotate(180);
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) matrix.postRotate(270);
                Bitmap out = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                out.compress(Bitmap.CompressFormat.JPEG, quality, bytes);
                JSObject result = new JSObject();
                result.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Couldn't open that photo." : e.getMessage());
            }
        }).start();
    }
}
