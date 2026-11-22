package com.lazarmarlin.americanatlas.car;

import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.Pane;
import androidx.car.app.model.PaneTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;

import java.util.Locale;

/** One place: what it is, how far, its points, and a button to drive there. */
final class PlaceScreen extends Screen {

    private final AtlasData.Place place;

    PlaceScreen(@NonNull CarContext carContext, @NonNull AtlasData.Place place) {
        super(carContext);
        this.place = place;
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        Pane.Builder pane = new Pane.Builder()
                .addRow(new Row.Builder()
                        .setTitle(AtlasData.label(place))
                        .addText(String.format(Locale.US, "%s mi away · %s", miles(place.miles), place.state))
                        .build())
                .addRow(new Row.Builder()
                        .setTitle(place.points > 0 ? "+" + place.points + " points" : "On the atlas")
                        .addText("Tracking adds it when you pass by, or add it on your phone.")
                        .build())
                .addAction(new Action.Builder()
                        .setTitle("Navigate")
                        .setOnClickListener(this::navigate)
                        .build());
        return new PaneTemplate.Builder(pane.build())
                .setTitle(place.name)
                .setHeaderAction(Action.BACK)
                .build();
    }

    private void navigate() {
        String q = place.lat + "," + place.lon + "(" + place.name + ")";
        Uri uri = Uri.parse("geo:" + place.lat + "," + place.lon + "?q=" + Uri.encode(q));
        try {
            getCarContext().startCarApp(new Intent(CarContext.ACTION_NAVIGATE, uri));
        } catch (RuntimeException err) {
            CarToast.makeText(getCarContext(), "No navigation app found", CarToast.LENGTH_LONG).show();
        }
    }

    private static String miles(double value) {
        return value < 10 ? String.format(Locale.US, "%.1f", value) : String.format(Locale.US, "%.0f", value);
    }
}
