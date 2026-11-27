package com.lazarmarlin.americanatlas;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Firebase Cloud Messaging. The server only sends a silent "poke" (no text);
 * this wakes the app's own message check, which asks the server and shows
 * the notification with the usual rules (quiet chats, nothing twice).
 */
public class AtlasPushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        android.content.Context app = getApplicationContext();
        MessageWatch.notePoke(app);
        // The Test push button: say it arrived, whatever else is new.
        if ("test".equals(message.getData().get("what"))) MessageWatch.showPushTest(app);
        // Already on a background thread, with time for one short request.
        MessageWatch.check(app);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // Uploaded next time the app opens (the web code registers it with the account).
        MessageWatch.notePushToken(getApplicationContext(), token);
    }
}
