package com.lazarmarlin.americanatlas;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.WebViewListener;
import java.util.Arrays;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MessageWatchPlugin.class);
        registerPlugin(SpeechPlugin.class);
        registerPlugin(TrackNotePlugin.class);
        registerPlugin(ApkUpdaterPlugin.class);
        registerPlugin(PhotoLibraryPlugin.class);
        registerPlugin(PowerPlugin.class);
        registerPlugin(WidgetPlugin.class);
        registerPlugin(GalleryPlugin.class);
        registerPlugin(MicPlugin.class);
        super.onCreate(savedInstanceState);
        // The web view asks again for the microphone even after this app was
        // allowed to use it, and that second ask always fails. If the app
        // already has the microphone, hand it straight to the page.
        WebView web = getBridge().getWebView();
        web.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                String[] resources = request.getResources();
                boolean audio = Arrays.asList(resources).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                boolean video = Arrays.asList(resources).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                boolean already = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                if (audio && !video && already) {
                    request.grant(resources);
                    return;
                }
                super.onPermissionRequest(request);
            }
        });
        // Android may close the web view's own process to free memory, most
        // often while the app is in the background. Left unhandled, Android
        // then kills the whole app, the location service included, so tracking
        // stopped until the app was opened again. Handle it instead: rebuild
        // the screen if it's showing, otherwise close just the screen and let
        // the location service keep running (it logs every fix, and the app
        // catches up when it's opened).
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    if (getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) recreate();
                    else finish();
                });
                return true;
            }
        });
    }
}
