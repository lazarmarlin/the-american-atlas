package com.lazarmarlin.americanatlas;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MessageWatchPlugin.class);
        registerPlugin(ApkUpdaterPlugin.class);
        registerPlugin(PhotoLibraryPlugin.class);
        registerPlugin(PowerPlugin.class);
        registerPlugin(WidgetPlugin.class);
        registerPlugin(GalleryPlugin.class);
        super.onCreate(savedInstanceState);
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
