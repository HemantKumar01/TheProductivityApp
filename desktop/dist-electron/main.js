"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const autostart_1 = require("./autostart");
const enforcement_1 = require("./enforcement");
let window = null;
let tray = null;
let quitting = false;
let rendererServer = null;
function configureUserDataPath() {
    const appData = electron_1.app.getPath("appData");
    const stablePath = node_path_1.default.join(appData, "deep-focus");
    const legacyPath = node_path_1.default.join(appData, "@deep-focus", "desktop");
    if (!node_fs_1.default.existsSync(stablePath) && node_fs_1.default.existsSync(legacyPath)) {
        node_fs_1.default.cpSync(legacyPath, stablePath, {
            recursive: true,
            filter: (source) => !node_path_1.default.basename(source).startsWith("Singleton"),
        });
    }
    electron_1.app.setPath("userData", stablePath);
}
function ensureLinuxAutostart() {
    if (process.platform !== "linux")
        return;
    const autostartFile = (0, autostart_1.linuxAutostartPath)(electron_1.app.getPath("home"), process.env.XDG_CONFIG_HOME);
    const command = electron_1.app.isPackaged
        // process.execPath is inside AppImage's temporary mount. APPIMAGE is the
        // stable executable path that remains valid at the next graphical login.
        ? [process.env.APPIMAGE || process.execPath, "--autostart"]
        : [process.execPath, electron_1.app.getAppPath(), "--autostart"];
    const entry = (0, autostart_1.buildLinuxAutostartEntry)(command);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(autostartFile), { recursive: true, mode: 0o700 });
    if (!node_fs_1.default.existsSync(autostartFile) || node_fs_1.default.readFileSync(autostartFile, "utf8") !== entry) {
        node_fs_1.default.writeFileSync(autostartFile, entry, { mode: 0o600 });
    }
}
function ensureWindowsAutostart() {
    if (process.platform !== "win32" || !electron_1.app.isPackaged)
        return;
    electron_1.app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ["--autostart"] });
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
    const iconPath = node_path_1.default.resolve(__dirname, "../assets/icon.png");
    window = new electron_1.BrowserWindow({
        show: !startHidden,
        width: 1180,
        height: 780,
        minWidth: 920,
        minHeight: 640,
        backgroundColor: "#171a16",
        icon: iconPath,
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
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
configureUserDataPath();
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
        electron_1.ipcMain.handle("focus:enforce", (_event, input) => (0, enforcement_1.sendActivation)(process.platform, input));
        ensureLinuxAutostart();
        ensureWindowsAutostart();
        createWindow(process.argv.includes("--autostart"));
        const trayIconPath = node_path_1.default.resolve(__dirname, "../assets/icon.png");
        const trayImage = electron_1.nativeImage.createFromPath(trayIconPath).resize({ width: 22, height: 22 });
        tray = new electron_1.Tray(trayImage);
        tray.setToolTip("Deep Focus is running");
        tray.setContextMenu(electron_1.Menu.buildFromTemplate([{ label: "Open Deep Focus", click: () => window?.show() }]));
        tray.on("double-click", () => window?.show());
    });
}
electron_1.app.on("before-quit", () => { quitting = true; rendererServer?.close(); });
electron_1.app.on("window-all-closed", () => { });
