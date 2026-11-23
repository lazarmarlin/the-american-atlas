package com.lazarmarlin.americanatlas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkUpdaterPlugin.class);
        registerPlugin(PhotoLibraryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
