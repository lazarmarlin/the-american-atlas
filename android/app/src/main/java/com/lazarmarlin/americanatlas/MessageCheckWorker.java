package com.lazarmarlin.americanatlas;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** The 15-minute background check for new messages, for when the app's process isn't running. */
public class MessageCheckWorker extends Worker {
    public MessageCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context app = getApplicationContext();
        MessageWatch.check(app);
        // If the location service kept the process alive, the minute-by-minute check resumes too.
        MessageWatch.start(app);
        return Result.success();
    }
}
