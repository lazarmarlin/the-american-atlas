package com.lazarmarlin.americanatlas.car;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableString;
import android.text.Spanned;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.constraints.ConstraintManager;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.CarLocation;
import androidx.car.app.model.Distance;
import androidx.car.app.model.DistanceSpan;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Metadata;
import androidx.car.app.model.ParkedOnlyOnClickListener;
import androidx.car.app.model.Place;
import androidx.car.app.model.PlaceListMapTemplate;
import androidx.car.app.model.PlaceMarker;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Nearby atlas places on a map drawn by Android Auto, closest first. Follows
 * the phone's location and refreshes after you've moved about a quarter mile.
 */
final class NearbyScreen extends Screen implements DefaultLifecycleObserver {

    static final String PREFS = "atlas_car";
    static final String PREF_FILTER = "filter";

    private static final long MIN_TIME_MS = 15_000;
    private static final float MIN_MOVE_M = 150;
    /** Re-query after moving this far, or after this long. */
    private static final float REQUERY_M = 400;
    private static final long REQUERY_MS = 120_000;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SharedPreferences prefs;
    private final AtlasData data;

    private AtlasData.Filter filter;
    private Location here;
    private Location queriedAt;
    private long queriedTime;
    private List<AtlasData.Place> places;
    private String error;
    private LocationManager locations;
    private final LocationListener listener = this::onLocation;
    private boolean listening;

    NearbyScreen(@NonNull CarContext carContext) {
        super(carContext);
        prefs = carContext.getSharedPreferences(PREFS, CarContext.MODE_PRIVATE);
        filter = AtlasData.Filter.fromId(prefs.getString(PREF_FILTER, AtlasData.Filter.SIGHTS.id));
        data = AtlasData.get(carContext);
        getLifecycle().addObserver(this);
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    public void onStart(@NonNull LifecycleOwner owner) {
        startLocation();
    }

    @Override
    public void onStop(@NonNull LifecycleOwner owner) {
        stopLocation();
    }

    @Override
    public void onDestroy(@NonNull LifecycleOwner owner) {
        io.shutdownNow();
    }

    // ---------------------------------------------------------------- location

    private boolean hasLocation() {
        CarContext ctx = getCarContext();
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocation() {
        if (listening || !hasLocation()) return;
        locations = getCarContext().getSystemService(LocationManager.class);
        if (locations == null) return;
        List<String> providers = new ArrayList<>(Arrays.asList(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) providers.add(0, LocationManager.FUSED_PROVIDER);
        try {
            Location best = null;
            for (String provider : providers) {
                if (!locations.isProviderEnabled(provider)) continue;
                Location last = locations.getLastKnownLocation(provider);
                if (last != null && (best == null || last.getTime() > best.getTime())) best = last;
                locations.requestLocationUpdates(provider, MIN_TIME_MS, MIN_MOVE_M, listener, Looper.getMainLooper());
                listening = true;
            }
            if (best != null) onLocation(best);
            if (!listening) {
                error = "Turn on location on your phone to see places near you.";
                invalidate();
            }
        } catch (SecurityException | IllegalArgumentException err) {
            error = "Couldn't read your location.";
            invalidate();
        }
    }

    private void stopLocation() {
        if (locations != null && listening) locations.removeUpdates(listener);
        listening = false;
    }

    private void onLocation(@NonNull Location location) {
        here = location;
        boolean moved = queriedAt == null || queriedAt.distanceTo(location) > REQUERY_M;
        boolean stale = System.currentTimeMillis() - queriedTime > REQUERY_MS;
        if (moved || stale) query();
    }

    // ---------------------------------------------------------------- data

    private void query() {
        if (here == null) return;
        final Location at = here;
        final AtlasData.Filter wanted = filter;
        final int limit = listLimit();
        queriedAt = at;
        queriedTime = System.currentTimeMillis();
        io.execute(() -> {
            try {
                List<AtlasData.Place> found = data.nearest(at.getLatitude(), at.getLongitude(), wanted, limit);
                main.post(() -> {
                    if (wanted != filter) return; // the filter changed while loading
                    places = found;
                    error = null;
                    invalidate();
                });
            } catch (IOException | RuntimeException err) {
                main.post(() -> {
                    error = "Couldn't load nearby places.";
                    invalidate();
                });
            }
        });
    }

    private int listLimit() {
        try {
            ConstraintManager constraints = getCarContext().getCarService(ConstraintManager.class);
            return Math.max(1, constraints.getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST));
        } catch (RuntimeException err) {
            return 6;
        }
    }

    // ---------------------------------------------------------------- template

    @NonNull
    @Override
    public Template onGetTemplate() {
        if (!hasLocation()) return locationOffTemplate();

        Action pickFilter = new Action.Builder()
                .setTitle("Filter")
                .setOnClickListener(() -> getScreenManager().pushForResult(new FilterScreen(getCarContext(), filter), result -> {
                    if (!(result instanceof String)) return;
                    AtlasData.Filter next = AtlasData.Filter.fromId((String) result);
                    if (next == filter) return;
                    filter = next;
                    prefs.edit().putString(PREF_FILTER, filter.id).apply();
                    places = null;
                    query();
                }))
                .build();

        PlaceListMapTemplate.Builder template = new PlaceListMapTemplate.Builder()
                .setTitle(filter.label)
                .setHeaderAction(Action.APP_ICON)
                .setCurrentLocationEnabled(true)
                .setActionStrip(new ActionStrip.Builder().addAction(pickFilter).build())
                .setOnContentRefreshListener(() -> {
                    queriedAt = null;
                    query();
                });

        if (places == null && error == null) return template.setLoading(true).build();

        ItemList.Builder list = new ItemList.Builder();
        if (error != null && places == null) {
            list.setNoItemsMessage(error);
        } else if (places.isEmpty()) {
            list.setNoItemsMessage("No " + filter.label.toLowerCase() + " within 60 miles.");
        } else {
            for (AtlasData.Place place : places) list.addItem(row(place));
        }
        return template.setItemList(list.build()).build();
    }

    private Row row(AtlasData.Place place) {
        // Leading character carries the distance; Android Auto formats it.
        SpannableString text = new SpannableString("· " + summary(place));
        text.setSpan(DistanceSpan.create(Distance.create(place.miles, place.miles < 10 ? Distance.UNIT_MILES_P1 : Distance.UNIT_MILES)),
                0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
        int color = AtlasData.color(place);
        Place marker = new Place.Builder(CarLocation.create(place.lat, place.lon))
                .setMarker(new PlaceMarker.Builder().setColor(CarColor.createCustom(color, color)).build())
                .build();
        return new Row.Builder()
                .setTitle(place.name)
                .addText(text)
                .setMetadata(new Metadata.Builder().setPlace(marker).build())
                .setOnClickListener(() -> getScreenManager().push(new PlaceScreen(getCarContext(), place)))
                .build();
    }

    static String summary(AtlasData.Place place) {
        String label = AtlasData.label(place);
        return place.points > 0 ? label + " · +" + place.points + " pts" : label;
    }

    private Template locationOffTemplate() {
        Action allow = new Action.Builder()
                .setTitle("Allow on phone")
                .setOnClickListener(ParkedOnlyOnClickListener.create(() -> {
                    getCarContext().requestPermissions(
                            Arrays.asList(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                            (granted, rejected) -> {
                                if (granted.isEmpty()) {
                                    CarToast.makeText(getCarContext(), "Location wasn't allowed", CarToast.LENGTH_LONG).show();
                                    return;
                                }
                                startLocation();
                                invalidate();
                            });
                    CarToast.makeText(getCarContext(), "Check your phone", CarToast.LENGTH_LONG).show();
                }))
                .build();
        return new MessageTemplate.Builder("The American Atlas needs your location to show places near you. Allow it on your phone.")
                .setTitle("Location is off")
                .setHeaderAction(Action.APP_ICON)
                .addAction(allow)
                .build();
    }
}
