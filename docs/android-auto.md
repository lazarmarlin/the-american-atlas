# Android Auto (work in progress)

This work lives on the `feat/android-auto` branch. The GitHub "Android APK"
workflow builds this branch too, so every push produces a debug APK with the car
screens.

## What it does

When the phone is connected to Android Auto, The American Atlas appears in the
car's app launcher.

- **Nearby**: Android Auto draws a map, and the closest atlas places show as
  pins next to a list. Each list entry gives the distance, what the place is,
  and its points. Pins use the same colors as on the phone.
  - The list follows the phone's location and refreshes after you've moved
    about a quarter mile, or every couple of minutes. There's also a refresh
    button.
  - It shows as many places as the car allows, usually six.
- **Filter**: choose Sights (the default), Towns & cities, Food & drink, Stops
  & chains, Historic sites, or Everything. The choice is remembered between
  drives.
- **Place details**: what it is, how far away it is, its state and its points,
  plus a **Navigate** button that hands off to Google Maps or Waze.
- **Location off**: a message with an "Allow on phone" button. It only works
  while parked, because the permission prompt appears on the phone.

The car screens read the atlas files that ship inside the app, so they work
with no signal. They don't sign in and don't show which places you've already
saved yet (see Next steps).

## Code

| File | Role |
| --- | --- |
| `car/AtlasCarAppService.java` | The entry point Android Auto binds to; host validation |
| `car/AtlasSession.java` | Opens the Nearby screen |
| `car/NearbyScreen.java` | Map and list, location updates, filter button |
| `car/PlaceScreen.java` | Place details and Navigate |
| `car/FilterScreen.java` | The filter list |
| `car/AtlasData.java` | Reads `assets/public/atlas`, finds the nearest places, colors and labels |

All of these are in `android/app/src/main/java/com/lazarmarlin/americanatlas/`.
The manifest declares the service with the **point-of-interest** category and
the `MAP_TEMPLATES` permission. `res/xml/automotive_app_desc.xml` marks the app
as an Android Auto app. The library is `androidx.car.app` 1.7.0, set as
`carAppVersion` in `android/variables.gradle`.

## Testing it

Android Auto hides apps that weren't installed from the Play Store until you
turn on its developer settings.

1. Install the debug APK from this branch's latest "Android APK" run, under
   Artifacts.
2. On the phone, open **Settings → Apps → Android Auto → Additional settings in
   the app** (or the Android Auto app itself). Scroll to **Version** and tap it
   about 10 times until developer settings unlock.
3. In the ⋮ menu, open **Developer settings** and turn on **Unknown sources**.
4. Then either:
   - **In the car:** connect the phone. The American Atlas appears in the
     launcher.
   - **On a computer:** run Google's Desktop Head Unit. In Android Auto's
     ⋮ menu, choose **Start head unit server**. Install the head unit from
     Android Studio's SDK Manager (SDK Tools → Android Auto Desktop Head Unit
     Emulator), then run `adb forward tcp:5277 tcp:5277` and start
     `desktop-head-unit`.

Allow the phone app location access once (turning on tracking does this), or
use "Allow on phone" in the car while parked.

## Before the Play Store

- Google reviews car apps separately, against its driver-distraction rules. A
  travel atlas is a less obvious fit for the point-of-interest category than
  parking or EV charging, so expect possible questions.
- Release builds only accept Google's own Android Auto hosts. Debug builds
  accept any host, so the Desktop Head Unit works.
- `PlaceListMapTemplate` is marked deprecated in Car App Library 1.7, in favor
  of `MapWithContentTemplate`. It still works on every Android Auto version,
  including older ones the newer template doesn't reach. Switch once older
  hosts no longer matter.

## Next steps

- **Show what you've saved:** sign in from the car side, using the bearer token
  the phone app keeps in `CapacitorStorage` preferences.
- **Recent adds:** a list of what tracking added on this drive.
- **Tracking on/off from the car.**
