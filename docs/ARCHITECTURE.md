# Deep Focus architecture

## Invariant

`users/{uid}/sessions/{sessionId}` is immutable after creation. A focus session is
active when `startsAt <= now < endsAt`. Starting focus while one is active returns
the existing session; it never shortens it. Neither client exposes an end action.

```text
Android app ─┐                         ┌─ Firestore session stream ─ Android accessibility service
             ├─ callable function ────┤
Desktop app ─┘                         └─ Firestore session stream ─ Linux DNS policy service
                           ▲
Cloud Scheduler ─ schedule materializer
```

## Firestore layout

```text
users/{uid}
  settings/blocking       { androidPackages[], websiteDomains[], allowedWebsiteDomains[], updatedAt }
  schedules/{scheduleId}  { enabled, weekdays[], localTime, timeZone, durationMinutes }
  sessions/{sessionId}    { startsAt, endsAt, source, scheduleId?, createdAt }
```

Sessions are append-only. Metrics are derived from session intervals, so overlapping
or back-to-back intervals are merged before totals and streaks are calculated.

## Enforcement boundaries

- Android uses an `AccessibilityService` to detect a blocked foreground package and
  immediately returns to the launcher. Android still permits a device owner to
  disable or uninstall the app. For organization-owned devices, promote the app to
  Device Owner and replace interception with `DevicePolicyManager#setPackagesSuspended`.
- Linux uses a dedicated `dnsmasq` resolver route for blocked domain suffixes, plus
  exact `/etc/hosts` entries for blocked roots. A root-owned systemd service persists
  the deadline across restarts and exposes activation only. Browsers configured with
  a custom DNS-over-HTTPS provider can bypass system DNS, and a root user can always
  undo enforcement.
- Website blocking applies to a domain and all of its subdomains. Explicit entries in
  `allowedWebsiteDomains` override a blocked parent for that subdomain subtree.
