import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("deepFocus", {
  platform: process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unsupported",
  enforceFocus: (input: { domains: string[]; allowedDomains: string[]; endsAtMillis: number }) => ipcRenderer.invoke("focus:enforce", input),
});
