package com.lazarmarlin.americanatlas.car;

import android.content.pm.ApplicationInfo;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

/**
 * Entry point Android Auto binds to (declared in AndroidManifest.xml with the
 * point-of-interest category). Shows nearby atlas places on a car-drawn map.
 */
public final class AtlasCarAppService extends CarAppService {

    @NonNull
    @Override
    public HostValidator createHostValidator() {
        // Debug builds (the APKs from GitHub Actions) accept any host, so the
        // Desktop Head Unit and sideloaded testing work. Release builds only
        // talk to Google's known Android Auto hosts.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
        }
        return new HostValidator.Builder(getApplicationContext())
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build();
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new AtlasSession();
    }
}
