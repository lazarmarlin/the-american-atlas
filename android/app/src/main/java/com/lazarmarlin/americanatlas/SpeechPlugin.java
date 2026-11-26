package com.lazarmarlin.americanatlas;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Spoken announcements while driving ("Entering Morton County"). Uses the
 * phone's own voice, ducks music or navigation while it talks (as a
 * navigation app would), and works with the app in the background.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ready = false;
    private final List<String> waiting = new ArrayList<>();
    private AudioManager audio;
    private AudioFocusRequest focus;
    private int talking = 0;

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private void ensure() {
        if (tts != null) return;
        tts = new TextToSpeech(getContext().getApplicationContext(), status -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setLanguage(Locale.US);
            tts.setAudioAttributes(attributes());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {}

                @Override
                public void onDone(String id) {
                    finished();
                }

                @Override
                public void onError(String id) {
                    finished();
                }
            });
            ready = true;
            synchronized (waiting) {
                for (String text : waiting) say(text);
                waiting.clear();
            }
        });
    }

    private AudioAttributes attributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private synchronized void say(String text) {
        if (talking == 0) duck();
        talking++;
        Bundle params = new Bundle();
        params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
        tts.speak(text, TextToSpeech.QUEUE_ADD, params, "atlas-" + System.nanoTime());
    }

    private synchronized void finished() {
        talking = Math.max(0, talking - 1);
        if (talking == 0) unduck();
    }

    private void duck() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes()).build();
            audio.requestAudioFocus(focus);
        } else {
            audio.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
    }

    private void unduck() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus != null) audio.abandonAudioFocusRequest(focus);
        } else {
            audio.abandonAudioFocus(null);
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }
        ensure();
        if (ready) say(text);
        else synchronized (waiting) {
            waiting.add(text);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        talking = 0;
        unduck();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
        tts = null;
        ready = false;
    }
}
