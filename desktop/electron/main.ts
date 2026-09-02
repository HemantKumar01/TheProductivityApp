import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { buildLinuxAutostartEntry, linuxAutostartPath } from "./autostart";

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let rendererServer: http.Server | null = null;
const socketPath = process.env.DEEP_FOCUS_SOCKET || "/run/deep-focus.sock";

function ensureLinuxAutostart() {
  if (process.platform !== "linux") return;
  const autostartFile = linuxAutostartPath(app.getPath("home"), process.env.XDG_CONFIG_HOME);
  const command = app.isPackaged
    ? [process.execPath, "--autostart"]
    : [process.execPath, app.getAppPath(), "--autostart"];
  const entry = buildLinuxAutostartEntry(command);
  fs.mkdirSync(path.dirname(autostartFile), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(autostartFile) || fs.readFileSync(autostartFile, "utf8") !== entry) {
    fs.writeFileSync(autostartFile, entry, { mode: 0o600 });
  }
}

function startRendererServer(): Promise<string> {
  const root = path.resolve(__dirname, "../dist");
  const contentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  rendererServer = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const requested = pathname === "/" ? "/index.html" : pathname;
    const file = path.resolve(root, `.${requested}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
        "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    rendererServer!.once("error", reject);
    rendererServer!.listen(0, "127.0.0.1", () => {
      const address = rendererServer!.address() as { port: number };
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function createWindow(startHidden: boolean) {
  window = new BrowserWindow({
    show: !startHidden,
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#171a16",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void startRendererServer().then((url) => window?.loadURL(url));
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window?.hide();
    }
  });
}

function sendActivation(input: { domains: string[]; allowedDomains: string[]; endsAtMillis: number }): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);
    let response = "";
    client.setEncoding("utf8");
    client.setTimeout(4_000);
    client.on("connect", () => client.write(`${JSON.stringify({ command: "activate", ...input })}\n`));
    client.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\n")) client.end();
    });
    client.on("end", () => {
      try { resolve(JSON.parse(response.trim())); }
      catch { resolve({ ok: false, error: "The Linux blocker returned an invalid response." }); }
    });
    client.on("timeout", () => { client.destroy(); resolve({ ok: false, error: "The Linux blocker timed out." }); });
    client.on("error", () => resolve({ ok: false, error: "Linux blocker unavailable. Run the Linux installer with sudo; Deep Focus will retry automatically." }));
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });

  app.whenReady().then(() => {
    ipcMain.handle("focus:enforce", (_event, input) => sendActivation(input));
    ensureLinuxAutostart();
    createWindow(process.argv.includes("--autostart"));
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip("Deep Focus is running");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open Deep Focus", click: () => window?.show() }]));
    tray.on("double-click", () => window?.show());
  });
}

app.on("before-quit", () => { quitting = true; rendererServer?.close(); });
app.on("window-all-closed", () => {});
