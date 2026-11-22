package com.lazarmarlin.americanatlas.car;

import android.content.Context;
import android.util.LruCache;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The atlas data the car screens show, read from the same files the phone app
 * ships (Capacitor copies public/ into assets/public/). Nothing here touches
 * the network, so the car screens work with no signal.
 *
 * Per-state place files are parsed once and kept in a small cache; Texas, the
 * largest, is about 2 MB. Call these from a background thread.
 */
final class AtlasData {

    static final class State {
        final String abbr;
        final String name;
        final double w, s, e, n;

        State(String abbr, String name, double w, double s, double e, double n) {
            this.abbr = abbr;
            this.name = name;
            this.w = w;
            this.s = s;
            this.e = e;
            this.n = n;
        }

        boolean near(double lat, double lon, double pad) {
            return lat >= s - pad && lat <= n + pad && lon >= w - pad && lon <= e + pad;
        }
    }

    static final class Place {
        final String id;
        final String name;
        final String category;
        final String state;
        final double lat, lon;
        final int points;
        double miles;

        Place(String id, String name, String category, String state, double lat, double lon, int points) {
            this.id = id;
            this.name = name;
            this.category = category;
            this.state = state;
            this.lat = lat;
            this.lon = lon;
            this.points = points;
        }

        Place withMiles(double value) {
            Place copy = new Place(id, name, category, state, lat, lon, points);
            copy.miles = value;
            return copy;
        }
    }

    /** What the car list shows. Ids are stored in preferences, so keep them stable. */
    enum Filter {
        SIGHTS("sights", "Sights", "park", "forest", "refuge", "seashore", "reservation", "capitol", "president",
                "highpoint", "waterfall", "cave", "battlefield", "fort", "lighthouse", "bridge", "span", "drive",
                "roadside", "garden", "zoo", "museum", "amusement", "beach"),
        TOWNS("towns", "Towns & cities", "town"),
        FOOD("food", "Food & drink", "food", "diner", "drivein", "brewery", "distillery", "winery", "market"),
        STOPS("stops", "Stops & chains", "chain", "mall", "airport", "stadium"),
        HISTORY("history", "Historic sites", "historic"),
        EVERYTHING("all", "Everything");

        final String id;
        final String label;
        /** Empty means every category except counties. */
        final Set<String> categories;

        Filter(String id, String label, String... categories) {
            this.id = id;
            this.label = label;
            this.categories = new HashSet<>(Arrays.asList(categories));
        }

        boolean includes(String category) {
            if ("county".equals(category)) return false;
            return categories.isEmpty() || categories.contains(category);
        }

        static Filter fromId(String id) {
            for (Filter filter : values()) if (filter.id.equals(id)) return filter;
            return SIGHTS;
        }
    }

    private static AtlasData instance;

    static synchronized AtlasData get(Context context) {
        if (instance == null) instance = new AtlasData(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private List<State> states;
    private final LruCache<String, List<Place>> byState = new LruCache<>(4);

    private AtlasData(Context context) {
        this.context = context;
    }

    synchronized List<State> states() throws IOException {
        if (states != null) return states;
        try {
            JSONObject meta = new JSONObject(read("public/atlas/meta.json"));
            JSONArray rows = meta.getJSONArray("states");
            List<State> out = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                out.add(new State(row.getString("abbr"), row.getString("name"), row.getDouble("w"), row.getDouble("s"),
                        row.getDouble("e"), row.getDouble("n")));
            }
            states = Collections.unmodifiableList(out);
            return states;
        } catch (org.json.JSONException err) {
            throw new IOException("meta.json", err);
        }
    }

    private List<Place> places(String abbr) throws IOException {
        List<Place> cached = byState.get(abbr);
        if (cached != null) return cached;
        List<Place> out = new ArrayList<>();
        try {
            JSONObject bundle = new JSONObject(read("public/atlas/places/" + abbr + ".json"));
            JSONArray names = bundle.names();
            for (int c = 0; names != null && c < names.length(); c++) {
                String category = names.getString(c);
                if ("county".equals(category)) continue;
                JSONArray rows = bundle.getJSONArray(category);
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject row = rows.getJSONObject(i);
                    if (!row.has("lat") || !row.has("lon") || row.isNull("lat") || row.isNull("lon")) continue;
                    out.add(new Place(row.getString("id"), row.optString("name", ""), category, abbr,
                            row.getDouble("lat"), row.getDouble("lon"), row.optInt("pts", 0)));
                }
            }
        } catch (org.json.JSONException err) {
            throw new IOException("places/" + abbr, err);
        }
        byState.put(abbr, out);
        return out;
    }

    /** The nearest places for a filter, closest first, one entry per place id. */
    List<Place> nearest(double lat, double lon, Filter filter, int limit) throws IOException {
        Map<String, Place> best = new HashMap<>();
        for (State state : states()) {
            // A degree of padding takes in places just over a nearby state line.
            if (!state.near(lat, lon, 1.0)) continue;
            for (Place place : places(state.abbr)) {
                if (!filter.includes(place.category)) continue;
                double miles = miles(lat, lon, place.lat, place.lon);
                if (miles > 60) continue;
                Place seen = best.get(place.id);
                if (seen == null || miles < seen.miles) best.put(place.id, place.withMiles(miles));
            }
        }
        List<Place> out = new ArrayList<>(best.values());
        Collections.sort(out, (a, b) -> Double.compare(a.miles, b.miles));
        return out.size() > limit ? new ArrayList<>(out.subList(0, limit)) : out;
    }

    /** Name of the state the point falls in by bounding box (smallest match), or "". */
    String stateName(double lat, double lon) throws IOException {
        State hit = null;
        for (State state : states()) {
            if (!state.near(lat, lon, 0)) continue;
            if (hit == null || area(state) < area(hit)) hit = state;
        }
        return hit == null ? "" : hit.name;
    }

    private static double area(State state) {
        return (state.e - state.w) * (state.n - state.s);
    }

    static double miles(double lat1, double lon1, double lat2, double lon2) {
        double r = 3958.8;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    private String read(String path) throws IOException {
        try (InputStream in = context.getAssets().open(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    // ---------------------------------------------------------------- labels and colors
    // Mirrors src/lib/place-kinds.ts so car pins match the phone map.

    private static final Pattern BUCEE = Pattern.compile("buc-?ee", Pattern.CASE_INSENSITIVE);
    private static final Pattern OUTFITTER = Pattern.compile("cabela|bass pro", Pattern.CASE_INSENSITIVE);
    private static final Pattern NATIONAL = Pattern.compile("national", Pattern.CASE_INSENSITIVE);

    private static final Map<String, String[]> KINDS = new HashMap<>();

    static {
        kind("city", "City", "#e2b15a");
        kind("town", "Town", "#f3e2b0");
        kind("park-national", "National park", "#3fa45b");
        kind("park-state", "State park", "#9ed68a");
        kind("reservation", "Reservation", "#c4894a");
        kind("forest", "Forest", "#2f6b45");
        kind("refuge", "Wildlife refuge", "#7dcea0");
        kind("capitol", "Capitol", "#d4762c");
        kind("beach", "Beach", "#3aa0c8");
        kind("stadium", "Stadium", "#7d6bb5");
        kind("museum", "Museum", "#c4923a");
        kind("historic", "Historic site", "#c4a484");
        kind("zoo", "Zoo", "#e07a3d");
        kind("brewery", "Brewery", "#e0b03a");
        kind("lighthouse", "Lighthouse", "#e36a4a");
        kind("bridge", "Covered bridge", "#b08968");
        kind("span-long", "Long bridge", "#d5e2ea");
        kind("span", "Famous bridge", "#8ea4b8");
        kind("airport-major", "Major airport", "#3d8fd4");
        kind("airport", "Airport", "#8ec3ea");
        kind("garden", "Garden", "#6aaf6a");
        kind("amusement", "Amusement park", "#e25d8c");
        kind("chain", "Regional chain", "#6a8cbf");
        kind("bucee", "Buc-ee's", "#e23d2b");
        kind("outfitter", "Bass Pro / Cabela's", "#3d8fd4");
        kind("market", "Grocery", "#8fbf5a");
        kind("food", "Regional food", "#e07050");
        kind("mall", "Mall", "#b07cc9");
        kind("roadside", "Roadside attraction", "#e2a04a");
        kind("highpoint", "State high point", "#f2f2f2");
        kind("seashore", "National seashore", "#3aa0c8");
        kind("battlefield", "Battlefield", "#8d6a5a");
        kind("drive", "Scenic drive", "#e2b15a");
        kind("waterfall", "Waterfall", "#7ec8e3");
        kind("cave", "Cave", "#6b5b4b");
        kind("president", "Presidential site", "#c4a484");
        kind("fort", "Fort", "#a67c52");
        kind("winery", "Winery", "#8e3a4a");
        kind("distillery", "Distillery", "#c47a3a");
        kind("drivein", "Drive-in", "#e25d8c");
        kind("diner", "Diner", "#e07050");
    }

    private static void kind(String id, String label, String color) {
        KINDS.put(id, new String[] {label, color});
    }

    static String kindOf(Place place) {
        if (BUCEE.matcher(place.name).find()) return "bucee";
        if (OUTFITTER.matcher(place.name).find()) return "outfitter";
        switch (place.category) {
            case "town":
                return place.points >= 30 ? "city" : "town";
            case "park":
                return NATIONAL.matcher(place.name).find() ? "park-national" : "park-state";
            case "span":
                return place.points >= 50 ? "span-long" : "span";
            case "airport":
                return place.points >= 50 ? "airport-major" : "airport";
            default:
                return KINDS.containsKey(place.category) ? place.category : "town";
        }
    }

    static String label(Place place) {
        String[] kind = KINDS.get(kindOf(place));
        return kind == null ? "Place" : kind[0];
    }

    static int color(Place place) {
        String[] kind = KINDS.get(kindOf(place));
        return android.graphics.Color.parseColor(kind == null ? "#e2b15a" : kind[1]);
    }
}
