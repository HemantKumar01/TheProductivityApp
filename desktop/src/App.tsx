import { FormEvent, useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { BarChart3, CalendarClock, ChevronRight, CircleAlert, Clock3, Globe2, LockKeyhole, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { auth, firebaseConfigured, firestore, functions } from "./firebase";
import { formatDuration, metricsFor } from "./metrics";
import type { BlockingSettings, FocusSchedule, FocusSession } from "./types";

const emptySettings: BlockingSettings = { androidPackages: [], websiteDomains: [], allowedWebsiteDomains: [] };
const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"];

function startOfToday(now: number) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function cleanDomain(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\.$/, "");
  if (!raw || raw.includes("://") || raw.includes("/") || raw.includes(":")) return null;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw)) return null;
  return raw;
}

function isStrictSubdomain(hostname: string, domain: string): boolean {
  return hostname.endsWith(`.${domain}`);
}

export function App() {
  const desktopPlatform = window.deepFocus?.platform === "windows" ? "Windows" : window.deepFocus?.platform === "linux" ? "Linux" : "Desktop";
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [settings, setSettings] = useState<BlockingSettings>(emptySettings);
  const [schedules, setSchedules] = useState<FocusSchedule[]>([]);
  const [now, setNow] = useState(Date.now());
  const [page, setPage] = useState<"focus" | "schedule" | "blocklist">("focus");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) return;
    return onAuthStateChanged(auth, setUser);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) return;
    const sessionQuery = query(collection(firestore, `users/${user.uid}/sessions`), orderBy("startsAt", "desc"), limit(300));
    const stopSessions = onSnapshot(sessionQuery, (snapshot) => setSessions(snapshot.docs.map((entry) => {
      const data = entry.data() as { startsAt: Timestamp; endsAt: Timestamp; source: FocusSession["source"] };
      return { id: entry.id, startsAtMillis: data.startsAt.toMillis(), endsAtMillis: data.endsAt.toMillis(), source: data.source };
    })));
    const stopSettings = onSnapshot(doc(firestore, `users/${user.uid}/settings/blocking`), (snapshot) => {
      if (snapshot.exists()) setSettings({ ...emptySettings, ...snapshot.data() } as BlockingSettings);
    });
    const stopSchedules = onSnapshot(collection(firestore, `users/${user.uid}/schedules`), (snapshot) => {
      setSchedules(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FocusSchedule)));
    });
    return () => { stopSessions(); stopSettings(); stopSchedules(); };
  }, [user]);

  const metrics = useMemo(() => metricsFor(sessions, now, startOfToday(now)), [sessions, now]);
  const activeSession = sessions.find((session) => session.startsAtMillis <= now && session.endsAtMillis > now);

  useEffect(() => {
    if (!activeSession || !window.deepFocus) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const enforce = async () => {
      const result = await window.deepFocus!.enforceFocus({
        domains: settings.websiteDomains,
        allowedDomains: settings.allowedWebsiteDomains,
        endsAtMillis: activeSession.endsAtMillis,
      });
      if (cancelled) return;
      setNotice(result.ok ? null : result.error || "Website enforcement failed.");
      if (!result.ok) retryTimer = window.setTimeout(enforce, 5_000);
    };
    void enforce();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [activeSession?.id, activeSession?.endsAtMillis, settings.websiteDomains.join("|"), settings.allowedWebsiteDomains.join("|")]);

  if (!firebaseConfigured) return <ConfigurationScreen />;
  if (user === undefined) return <LoadingScreen />;
  if (!user) return <AuthScreen />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><BrandMark /><span>DEEP<br />FOCUS</span></div>
        <nav aria-label="Primary navigation">
          <NavButton active={page === "focus"} icon={<Clock3 />} label="Focus" onClick={() => setPage("focus")} />
          <NavButton active={page === "schedule"} icon={<CalendarClock />} label="Schedule" onClick={() => setPage("schedule")} />
          <NavButton active={page === "blocklist"} icon={<ShieldCheck />} label="Blocklist" onClick={() => setPage("blocklist")} />
        </nav>
        <div className="sidebar-footer">
          <div className="sync-state"><span /> Synced across devices</div>
          <button className="quiet-button" disabled={Boolean(activeSession)} onClick={() => signOut(auth)} title={activeSession ? "Sign out is unavailable during focus" : "Sign out"}>
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <main id="main" className="main-content">
        {notice && <div className="alert" role="alert"><CircleAlert aria-hidden="true" /> <span>{notice}</span></div>}
        {page === "focus" && <FocusPage user={user} sessions={sessions} metrics={metrics} active={activeSession} now={now} />}
        {page === "schedule" && <SchedulePage user={user} schedules={schedules} active={Boolean(activeSession)} />}
        {page === "blocklist" && <BlocklistPage user={user} settings={settings} active={Boolean(activeSession)} desktopPlatform={desktopPlatform} />}
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span><ChevronRight className="nav-chevron" aria-hidden="true" /></button>;
}

function BrandMark() {
  return <svg className="brand-mark" aria-hidden="true" viewBox="0 0 128 128"><path d="M64 18 A46 46 0 1 0 110 64" /></svg>;
}

function FocusPage({ user, sessions, metrics, active, now }: { user: User; sessions: FocusSession[]; metrics: ReturnType<typeof metricsFor>; active?: FocusSession; now: number }) {
  const [durationInput, setDurationInput] = useState("45");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const duration = Number(durationInput);
  const durationValid = Number.isInteger(duration) && duration >= 5 && duration <= 480;

  async function start() {
    if (!durationValid) { setError("Enter a whole number from 5 to 480 minutes."); return; }
    setStarting(true); setError("");
    try {
      await httpsCallable(functions, "startFocus")({ durationMinutes: duration, source: "desktop" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start focus.");
    } finally { setStarting(false); }
  }

  const remaining = active ? active.endsAtMillis - now : 0;
  const recent = sessions.filter((session) => session.endsAtMillis <= now).slice(0, 3);
  return <div className="page focus-page">
    <header className="page-header"><p className="eyebrow">Your attention, protected</p><h1>{active ? "Stay with it." : "Make room for deep work."}</h1><p>{active ? "Your blocklists are active on every connected device." : "Choose a duration. Once it begins, the session runs to completion."}</p></header>

    <section className={`focus-instrument ${active ? "is-active" : ""}`} aria-live="polite">
      <div className="instrument-status"><LockKeyhole aria-hidden="true" /> {active ? "FOCUS LOCKED" : "READY"}</div>
      <div className="timer-number">{active ? formatClock(remaining) : durationValid ? `${duration}:00` : "--:--"}</div>
      <div className="timer-caption">{active ? `Ends at ${new Date(active.endsAtMillis).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "minutes of uninterrupted attention"}</div>
      {!active && <div className="manual-duration"><label htmlFor="focus-duration">Focus duration</label><div><input id="focus-duration" type="number" min="5" max="480" step="1" inputMode="numeric" value={durationInput} onChange={(event) => setDurationInput(event.target.value)} aria-describedby="focus-duration-help" /><span>minutes</span></div><small id="focus-duration-help">Choose any whole number from 5 minutes to 8 hours.</small></div>}
      {active ? <div className="commitment-note"><span /> This session cannot be ended early</div> : <button className="start-button" disabled={starting || !durationValid} onClick={start}>{starting ? "Starting…" : "Begin focus"}<ChevronRight aria-hidden="true" /></button>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>

    <section aria-labelledby="metrics-title"><div className="section-heading"><div><p className="eyebrow">Measured, not gamified</p><h2 id="metrics-title">Today at a glance</h2></div><BarChart3 aria-hidden="true" /></div>
      <div className="metrics-grid">
        <Metric label="Focus today" value={formatDuration(metrics.focusTodayMs)} detail="since midnight" />
        <Metric label="Continuous focus" value={formatDuration(metrics.continuousMs)} detail={active ? "current session" : "not focusing now"} />
        <Metric label="Longest stretch" value={formatDuration(metrics.longestMs)} detail="all recorded time" />
        <Metric label="Sessions complete" value={String(metrics.completedCount)} detail="all recorded time" />
      </div>
    </section>

    <section className="recent-section"><h2>Recent sessions</h2>{recent.length ? recent.map((session) => <div className="session-row" key={session.id}><span className={`source-dot ${session.source}`} /><div><strong>{formatDuration(session.endsAtMillis - session.startsAtMillis)}</strong><small>{new Date(session.startsAtMillis).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {session.source}</small></div><time>{new Date(session.startsAtMillis).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>) : <p className="empty-copy">Your completed sessions will appear here.</p>}</section>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function SchedulePage({ user, schedules, active }: { user: User; schedules: FocusSchedule[]; active: boolean }) {
  const [time, setTime] = useState("09:00");
  const [durationInput, setDurationInput] = useState("60");
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const duration = Number(durationInput);
  const durationValid = Number.isInteger(duration) && duration >= 5 && duration <= 480;

  async function addSchedule(event: FormEvent) {
    if (!durationValid) { event.preventDefault(); setError("Enter a whole number from 5 to 480 minutes."); return; }
    event.preventDefault(); setSaving(true);
    try {
      await addDoc(collection(firestore, `users/${user.uid}/schedules`), {
        enabled: true, weekdays: days, localTime: time,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        durationMinutes: duration, createdAt: serverTimestamp(),
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this schedule.");
    } finally { setSaving(false); }
  }

  async function removeSchedule(scheduleId: string) {
    if (active) return;
    setDeleting(scheduleId); setError("");
    try {
      await deleteDoc(doc(firestore, `users/${user.uid}/schedules/${scheduleId}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this schedule.");
    } finally { setDeleting(null); }
  }

  return <div className="page"><header className="page-header"><p className="eyebrow">Ritual beats willpower</p><h1>Reserve your best hours.</h1><p>Schedules are started by the backend and arrive on every connected device.</p></header>
    <div className="two-column">
      <form className="panel schedule-form" onSubmit={addSchedule}>
        <h2>New schedule</h2><label htmlFor="schedule-time">Start time</label><input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
        <fieldset><legend>Repeat on</legend><div className="weekday-row">{weekdayLabels.map((label, index) => { const day = index + 1; return <button type="button" key={day} className={days.includes(day) ? "selected" : ""} aria-pressed={days.includes(day)} onClick={() => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort())}>{label}</button>; })}</div></fieldset>
        <label htmlFor="schedule-duration">Duration in minutes</label><input id="schedule-duration" type="number" min="5" max="480" step="1" inputMode="numeric" value={durationInput} onChange={(event) => setDurationInput(event.target.value)} required />
        <button className="primary-button" disabled={saving || days.length === 0 || !durationValid}>{saving ? "Saving…" : "Add schedule"}<Plus aria-hidden="true" /></button>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
      <section className="panel" aria-labelledby="saved-schedules"><h2 id="saved-schedules">Saved schedules</h2>{schedules.length ? schedules.map((schedule) => <div className="schedule-row" key={schedule.id}><div className="schedule-time">{schedule.localTime}</div><div><strong>{formatDays(schedule.weekdays)}</strong><small>{schedule.durationMinutes} min · {schedule.timeZone}</small></div><span className="enabled-pill">On</span><button type="button" className="schedule-delete" aria-label={`Delete ${schedule.localTime} schedule`} title={active ? "Schedules cannot be deleted during focus" : "Delete schedule"} disabled={active || deleting === schedule.id} onClick={() => removeSchedule(schedule.id)}><Trash2 aria-hidden="true" /></button></div>) : <p className="empty-copy">No repeating sessions yet.</p>} {active && <p className="lock-note"><LockKeyhole aria-hidden="true" /> Schedules cannot be deleted until the current focus session finishes.</p>}</section>
    </div>
  </div>;
}

function BlocklistPage({ user, settings, active, desktopPlatform }: { user: User; settings: BlockingSettings; active: boolean; desktopPlatform: string }) {
  const [blockedValue, setBlockedValue] = useState("");
  const [allowedValue, setAllowedValue] = useState("");
  const [blockedError, setBlockedError] = useState("");
  const [allowedError, setAllowedError] = useState("");
  async function save(domains: string[], allowedDomains: string[]) {
    await setDoc(doc(firestore, `users/${user.uid}/settings/blocking`), {
      ...settings,
      websiteDomains: domains,
      allowedWebsiteDomains: allowedDomains,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
  async function addBlocked(event: FormEvent) {
    event.preventDefault();
    const domain = cleanDomain(blockedValue);
    if (!domain) { setBlockedError("Enter a domain such as reddit.com—without https://, a path, or a port."); return; }
    if (settings.websiteDomains.includes(domain)) { setBlockedError("That domain is already blocked."); return; }
    setBlockedError("");
    await save([...settings.websiteDomains, domain].sort(), settings.allowedWebsiteDomains);
    setBlockedValue("");
  }
  async function addAllowed(event: FormEvent) {
    event.preventDefault();
    const hostname = cleanDomain(allowedValue);
    if (!hostname) { setAllowedError("Enter an exact subdomain such as docs.example.com."); return; }
    if (!settings.websiteDomains.some((domain) => isStrictSubdomain(hostname, domain))) {
      setAllowedError("This must be a subdomain of one of the blocked domains.");
      return;
    }
    if (settings.allowedWebsiteDomains.includes(hostname)) { setAllowedError("That subdomain is already allowed."); return; }
    setAllowedError("");
    await save(settings.websiteDomains, [...settings.allowedWebsiteDomains, hostname].sort());
    setAllowedValue("");
  }
  async function removeBlocked(domain: string) {
    const domains = settings.websiteDomains.filter((item) => item !== domain);
    const allowedDomains = settings.allowedWebsiteDomains.filter((hostname) => domains.some((root) => isStrictSubdomain(hostname, root)));
    await save(domains, allowedDomains);
  }
  return <div className="page"><header className="page-header"><p className="eyebrow">Define the boundary</p><h1>Keep the noise outside.</h1><p>Blocking <code>example.com</code> also blocks every subdomain. Add narrow exceptions below when a useful subdomain must remain available.</p></header>
    <section className="panel blocklist-panel"><div className="section-heading compact"><div><p className="eyebrow">{desktopPlatform} websites</p><h2>{settings.websiteDomains.length} blocked hostname{settings.websiteDomains.length === 1 ? "" : "s"}</h2></div><Globe2 aria-hidden="true" /></div>
      <div className="policy-section"><h3>Blocked domains</h3><p>Each entry covers the domain and all of its subdomains.</p>
      <form className="domain-form" onSubmit={addBlocked}><div><label htmlFor="blocked-domain">Domain</label><input id="blocked-domain" type="text" inputMode="url" autoCapitalize="none" placeholder="youtube.com" value={blockedValue} disabled={active} onChange={(event) => setBlockedValue(event.target.value)} aria-describedby="blocked-domain-help" /><small id="blocked-domain-help">No protocol, path, port, or wildcard.</small></div><button className="primary-button" disabled={active}>Block domain<Plus aria-hidden="true" /></button></form>
      {blockedError && <p className="field-error" role="alert">{blockedError}</p>}
      {active && <p className="lock-note"><LockKeyhole aria-hidden="true" /> Blocklists are locked until the current focus session finishes.</p>}
      <div className="domain-list">{settings.websiteDomains.map((domain) => <div className="domain-row" key={domain}><span className="domain-icon"><Globe2 aria-hidden="true" /></span><div><strong>{domain}</strong><small>Includes all subdomains</small></div><button aria-label={`Remove ${domain}`} disabled={active} onClick={() => removeBlocked(domain)}><Trash2 aria-hidden="true" /></button></div>)}{!settings.websiteDomains.length && <p className="empty-copy">Add the sites that most often pull you away.</p>}</div></div>
      <div className="policy-section allow-policy"><h3>Allowed subdomains</h3><p>Explicit exceptions inside blocked domains. Each exception also allows its descendants.</p>
      <form className="domain-form" onSubmit={addAllowed}><div><label htmlFor="allowed-domain">Subdomain</label><input id="allowed-domain" type="text" inputMode="url" autoCapitalize="none" placeholder="music.youtube.com" value={allowedValue} disabled={active} onChange={(event) => setAllowedValue(event.target.value)} aria-describedby="allowed-domain-help" /><small id="allowed-domain-help">Must belong to a domain listed above.</small></div><button className="secondary-button" disabled={active}>Allow subdomain<Plus aria-hidden="true" /></button></form>
      {allowedError && <p className="field-error" role="alert">{allowedError}</p>}
      <div className="domain-list">{settings.allowedWebsiteDomains.map((hostname) => <div className="domain-row allowed" key={hostname}><span className="domain-icon"><ShieldCheck aria-hidden="true" /></span><div><strong>{hostname}</strong><small>Allowed subtree</small></div><button aria-label={`Remove ${hostname} exception`} disabled={active} onClick={() => save(settings.websiteDomains, settings.allowedWebsiteDomains.filter((item) => item !== hostname))}><Trash2 aria-hidden="true" /></button></div>)}{!settings.allowedWebsiteDomains.length && <p className="empty-copy">No subdomain exceptions.</p>}</div></div>
    </section>
  </div>;
}

function AuthScreen() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace("Firebase: ", "") : "Authentication failed.");
    } finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="auth-intro"><div className="brand light"><BrandMark />DEEP FOCUS</div><p className="eyebrow">A contract with your attention</p><h1>Less willpower.<br /><em>More protected time.</em></h1><p>One focus switch across Android and desktop computers. No early exits, no bargaining.</p><div className="auth-rule"><span>01</span> Choose your boundaries</div><div className="auth-rule"><span>02</span> Set the time aside</div><div className="auth-rule"><span>03</span> Do the work</div></section><section className="auth-card"><div><p className="eyebrow">Welcome</p><h2>Sign in to your focus space</h2></div><p className="auth-explainer">Use the same Google account on Android and your computers to keep sessions, schedules, blocklists, and metrics in sync.</p>{error && <p className="field-error" role="alert">{error}</p>}<button className="google-button" disabled={busy} onClick={submit}><GoogleMark />{busy ? "Waiting for Google…" : "Continue with Google"}</button><p className="browser-note">Authentication is handled by Firebase.</p></section></main>;
}

function ConfigurationScreen() {
  return <main className="auth-shell"><section className="auth-intro"><div className="brand light"><BrandMark />DEEP FOCUS</div><p className="eyebrow">ONE-TIME SETUP</p><h1>Connect your<br /><em>focus space.</em></h1><p>The app is installed correctly. Add your Firebase configuration to begin syncing across devices.</p><div className="auth-rule"><span>01</span> Enable Google in Firebase Auth</div><div className="auth-rule"><span>02</span> Add the Firebase Web App values</div><div className="auth-rule"><span>03</span> Restart Deep Focus</div></section><section className="auth-card config-card"><div><p className="eyebrow">CONFIGURATION REQUIRED</p><h2>Finish Firebase setup</h2></div><p>Create <code>desktop/.env</code> from the example and add the Firebase Web App values.</p><pre>VITE_FIREBASE_API_KEY=…{"\n"}VITE_FIREBASE_AUTH_DOMAIN=…{"\n"}VITE_FIREBASE_PROJECT_ID=…{"\n"}VITE_FIREBASE_APP_ID=…</pre><p className="config-help">Detailed steps are in the repository README.</p></section></main>;
}

function GoogleMark() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.74 2.98-4.32 2.98-7.41Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.06v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.32-1.93V7.45H3.06A10 10 0 0 0 2 12c0 1.63.39 3.17 1.06 4.55l3.34-2.62Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.94 5.45l3.34 2.62c.79-2.37 3-4.13 5.6-4.13Z"/></svg>; }

function LoadingScreen() { return <main className="loading-screen"><div className="brand"><BrandMark />DEEP FOCUS</div><div className="loading-line" aria-label="Loading" /></main>; }
function formatClock(ms: number) { const seconds = Math.max(0, Math.ceil(ms / 1_000)); return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; }
function formatDays(days: number[]) { if (days.length === 7) return "Every day"; if (days.join() === "1,2,3,4,5") return "Weekdays"; return days.map((day) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day]).join(", "); }
