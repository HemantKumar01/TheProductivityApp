# TheProductivityApp

A synchronized, non-interruptible focus system for Android and Linux. Starting a
manual or scheduled session creates one immutable Firestore session. Android blocks
selected apps and Linux blocks selected domain trees until that deadline passes.

## What is included

- `android/` — Kotlin + Jetpack Compose app, Firebase Google auth, live
  metrics, schedules, installed-app blocklist, and AccessibilityService enforcement.
- `desktop/` — Electron + React Linux app, Firebase auth, live metrics, schedules,
  subdomain-aware blocklist with explicit allowed-subdomain exceptions, and a
  background tray process.
- `desktop/linux/` — root-owned systemd service that combines a root-host fallback
  with a dedicated `dnsmasq` route for wildcard subdomain enforcement. It has no
  early-stop IPC operation.
- `firebase/` — callable manual-start function, once-per-minute schedule
  materializer, append-only Firestore rules, and tests.

## Firebase setup

1. Create a Firebase project and enable **Google** in Authentication → Sign-in method.
2. Create a Firestore database. Use a paid Firebase plan for the scheduled function.
3. Add an Android app with package `dev.deepfocus.app`, add the SHA-1 and SHA-256
   fingerprints for your signing key, then download the updated `google-services.json`
   to `android/app/google-services.json`. The updated file must contain the Web OAuth
   client used by Android Credential Manager.
4. Add a Firebase Web App. Copy `desktop/.env.example` to `desktop/.env` and fill in
   that Web App configuration. The desktop client uses Firebase Auth's
   `GoogleAuthProvider` directly; no separate Desktop OAuth client is needed.
5. In Firebase Authentication → Settings → Authorized domains, add `127.0.0.1`
   and `localhost`. Development uses localhost and the packaged Electron app serves
   its bundled UI from a private loopback origin for Firebase's popup handler.
6. Copy `.firebaserc.example` to `.firebaserc` and replace the project id.
7. Install and deploy:
****
   ```bash
   npm install
   npm install -g firebase-tools
   firebase login
   npm run build
   firebase deploy --only functions,firestore
   ```

Both apps must use the same Firebase project so they resolve to the same Firebase
user. The functions deploy to `asia-south1`. Change that region in both clients and
`firebase/functions/src/index.ts` if your Firebase project uses another region.

## Run the Linux desktop app

Install the privileged domain-tree service once:

```bash
sudo desktop/linux/install-linux.sh
```

The installer requires `dnsmasq-base`, `iproute2`, and `systemd-resolved` (present by
default on the supported Ubuntu/Linux Mint setup). It routes only blocked domain
suffixes through Deep Focus; other DNS continues using the network's normal servers.

Then start the desktop UI:

```bash
npm run desktop
```

The first launch creates `~/.config/autostart/deep-focus.desktop`. On later
graphical logins Deep Focus starts hidden in the background, reconnects its
Firebase listeners, and continues forwarding active sessions to the blocker.
Launching the app manually brings the existing instance to the foreground.

Closing the window hides it; the Firebase listener remains active in the background
so scheduled sessions still reach the Linux blocker. The systemd service keeps the
hosts deadline even if the Electron process is killed or the machine restarts.

## Run Android

Open `android/` in Android Studio, sync Gradle, and run on API 26+. On first launch,
sign in and enable **Deep Focus** under Android Accessibility settings when prompted.
The service observes foreground app changes and returns to the launcher when a
blocked package is opened during focus.

## Test

```bash
npm test
python3 -m py_compile desktop/linux/deep-focus-hosts-daemon.py
```

Android requires an installed Android SDK; build it with `./gradlew :app:assembleDebug`
from the `android/` directory or Android Studio's terminal.

## Important enforcement limits

There is deliberately no stop-session API or UI, blocklists are locked while focus
is active, sessions cannot be edited or deleted, and Linux uninstall refuses to run
during an active deadline. Still, no consumer application can defeat a device owner:

- an Android owner can disable Accessibility, force-stop, or uninstall the app;
- a Linux root user can edit `/etc/hosts` or stop the service.

For managed Android devices, make the app Device Owner and enforce packages with
`DevicePolicyManager#setPackagesSuspended` for stronger tamper resistance. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data flow and trust boundaries.
