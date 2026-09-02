export interface FocusSession {
  id: string;
  startsAtMillis: number;
  endsAtMillis: number;
  source: "android" | "desktop" | "schedule";
}

export interface BlockingSettings {
  androidPackages: string[];
  websiteDomains: string[];
  allowedWebsiteDomains: string[];
}

export interface FocusSchedule {
  id: string;
  enabled: boolean;
  weekdays: number[];
  localTime: string;
  timeZone: string;
  durationMinutes: number;
}
