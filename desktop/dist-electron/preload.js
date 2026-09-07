"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("deepFocus", {
    platform: process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unsupported",
    enforceFocus: (input) => electron_1.ipcRenderer.invoke("focus:enforce", input),
});
