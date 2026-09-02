import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("deepFocus", {
  enforceFocus: (input: { domains: string[]; allowedDomains: string[]; endsAtMillis: number }) => ipcRenderer.invoke("focus:enforce", input),
});
