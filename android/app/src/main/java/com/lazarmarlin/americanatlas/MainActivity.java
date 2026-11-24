package com.lazarmarlin.americanatlas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkUpdaterPlugin.class);
        registerPlugin(PhotoLibraryPlugin.class);
        registerPlugin(PowerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
