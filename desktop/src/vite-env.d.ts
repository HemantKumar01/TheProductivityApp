/// <reference types="vite/client" />

interface Window {
  deepFocus?: {
    platform: "linux" | "windows" | "unsupported";
    enforceFocus(input: { domains: string[]; allowedDomains: string[]; endsAtMillis: number }): Promise<{ ok: boolean; error?: string }>;
  };
}
