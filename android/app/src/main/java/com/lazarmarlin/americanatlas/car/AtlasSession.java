package com.lazarmarlin.americanatlas.car;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.Screen;
import androidx.car.app.Session;

/** One car session. It opens on Nearby, which also handles location being off. */
final class AtlasSession extends Session {

    @NonNull
    @Override
    public Screen onCreateScreen(@NonNull Intent intent) {
        return new NearbyScreen(getCarContext());
    }
}
