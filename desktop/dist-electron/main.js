"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_net_1 = __importDefault(require("node:net"));
const node_path_1 = __importDefault(require("node:path"));
const autostart_1 = require("./autostart");
let window = null;
let tray = null;
let quitting = false;
let rendererServer = null;
const socketPath = process.env.DEEP_FOCUS_SOCKET || "/run/deep-focus.sock";
function ensureLinuxAutostart() {
    if (process.platform !== "linux")
        return;
    const autostartFile = (0, autostart_1.linuxAutostartPath)(electron_1.app.getPath("home"), process.env.XDG_CONFIG_HOME);
    const command = electron_1.app.isPackaged
        ? [process.execPath, "--autostart"]
        : [process.execPath, electron_1.app.getAppPath(), "--autostart"];
    const entry = (0, autostart_1.buildLinuxAutostartEntry)(command);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(autostartFile), { recursive: true, mode: 0o700 });
    if (!node_fs_1.default.existsSync(autostartFile) || node_fs_1.default.readFileSync(autostartFile, "utf8") !== entry) {
        node_fs_1.default.writeFileSync(autostartFile, entry, { mode: 0o600 });
    }
}
function startRendererServer() {
    const root = node_path_1.default.resolve(__dirname, "../dist");
    const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
    };
    rendererServer = node_http_1.default.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
        const requested = pathname === "/" ? "/index.html" : pathname;
        const file = node_path_1.default.resolve(root, `.${requested}`);
        if (file !== root && !file.startsWith(`${root}${node_path_1.default.sep}`)) {
            response.writeHead(403).end("Forbidden");
            return;
        }
        node_fs_1.default.readFile(file, (error, body) => {
            if (error) {
                response.writeHead(404).end("Not found");
                return;
            }
            response.writeHead(200, {
                "Content-Type": contentTypes[node_path_1.default.extname(file)] || "application/octet-stream",
                "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
            });
            response.end(body);
        });
    });
    return new Promise((resolve, reject) => {
        rendererServer.once("error", reject);
        rendererServer.listen(0, "127.0.0.1", () => {
            const address = rendererServer.address();
            resolve(`http://127.0.0.1:${address.port}`);
        });
    });
}
function createWindow(startHidden) {
    window = new electron_1.BrowserWindow({
        show: !startHidden,
        width: 1180,
        height: 780,
        minWidth: 920,
        minHeight: 640,
        backgroundColor: "#171a16",
        titleBarStyle: "hiddenInset",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    const developmentUrl = process.env.VITE_DEV_SERVER_URL;
    if (developmentUrl)
        void window.loadURL(developmentUrl);
    else
        void startRendererServer().then((url) => window?.loadURL(url));
    window.on("close", (event) => {
        if (!quitting) {
            event.preventDefault();
            window?.hide();
        }
    });
}
function sendActivation(input) {
    return new Promise((resolve) => {
        const client = node_net_1.default.createConnection(socketPath);
        let response = "";
        client.setEncoding("utf8");
        client.setTimeout(4_000);
        client.on("connect", () => client.write(`${JSON.stringify({ command: "activate", ...input })}\n`));
        client.on("data", (chunk) => {
            response += chunk;
            if (response.includes("\n"))
                client.end();
        });
        client.on("end", () => {
            try {
                resolve(JSON.parse(response.trim()));
            }
            catch {
                resolve({ ok: false, error: "The Linux blocker returned an invalid response." });
            }
        });
        client.on("timeout", () => { client.destroy(); resolve({ ok: false, error: "The Linux blocker timed out." }); });
        client.on("error", () => resolve({ ok: false, error: "Linux blocker unavailable. Run the Linux installer with sudo; Deep Focus will retry automatically." }));
    });
}
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", () => {
        if (window?.isMinimized())
            window.restore();
        window?.show();
        window?.focus();
    });
    electron_1.app.whenReady().then(() => {
        electron_1.ipcMain.handle("focus:enforce", (_event, input) => sendActivation(input));
        ensureLinuxAutostart();
        createWindow(process.argv.includes("--autostart"));
        tray = new electron_1.Tray(electron_1.nativeImage.createEmpty());
        tray.setToolTip("Deep Focus is running");
        tray.setContextMenu(electron_1.Menu.buildFromTemplate([{ label: "Open Deep Focus", click: () => window?.show() }]));
        tray.on("double-click", () => window?.show());
    });
}
electron_1.app.on("before-quit", () => { quitting = true; rendererServer?.close(); });
electron_1.app.on("window-all-closed", () => { });
