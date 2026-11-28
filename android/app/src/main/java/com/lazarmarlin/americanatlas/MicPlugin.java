package com.lazarmarlin.americanatlas;

import android.Manifest;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Asks for the microphone before a voice note (and the camera before a picture). The web view's own prompt
 * reports failure even after the phone has allowed it, so the page asks here
 * first and only then opens the mic.
 */
@CapacitorPlugin(
    name = "Mic",
    permissions = {
        @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
    }
)
public class MicPlugin extends Plugin {
    @PluginMethod
    public void allow(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("mic", call, "allowed");
    }

    @PermissionCallback
    private void allowed(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) call.resolve();
        else call.reject("denied");
    }

    @PluginMethod
    public void allowCamera(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("camera", call, "cameraAllowed");
    }

    @PermissionCallback
    private void cameraAllowed(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) call.resolve();
        else call.reject("denied");
    }
}
