/// <reference types="vite/client" />

interface Window {
  deepFocus?: {
    enforceFocus(input: { domains: string[]; allowedDomains: string[]; endsAtMillis: number }): Promise<{ ok: boolean; error?: string }>;
  };
}
