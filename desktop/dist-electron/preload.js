"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("deepFocus", {
    enforceFocus: (input) => electron_1.ipcRenderer.invoke("focus:enforce", input),
});
