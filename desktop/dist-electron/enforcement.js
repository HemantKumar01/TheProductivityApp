"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforcementEndpoint = enforcementEndpoint;
exports.enforcementUnavailableMessage = enforcementUnavailableMessage;
exports.sendActivation = sendActivation;
const node_net_1 = __importDefault(require("node:net"));
function enforcementEndpoint(platform, environment = process.env) {
    if (platform === "win32")
        return environment.DEEP_FOCUS_PIPE || "\\\\.\\pipe\\deep-focus";
    if (platform === "linux")
        return environment.DEEP_FOCUS_SOCKET || "/run/deep-focus.sock";
    return null;
}
function enforcementUnavailableMessage(platform) {
    if (platform === "win32")
        return "Windows blocker unavailable. Reinstall Deep Focus as an administrator; it will retry automatically.";
    if (platform === "linux")
        return "Linux blocker unavailable. Run the Linux installer with sudo; Deep Focus will retry automatically.";
    return "Website enforcement is unavailable on this platform.";
}
function sendActivation(platform, input) {
    const endpoint = enforcementEndpoint(platform);
    if (!endpoint)
        return Promise.resolve({ ok: false, error: enforcementUnavailableMessage(platform) });
    return new Promise((resolve) => {
        const client = node_net_1.default.createConnection(endpoint);
        let response = "";
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            resolve(result);
        };
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
                finish(JSON.parse(response.trim()));
            }
            catch {
                finish({ ok: false, error: "The website blocker returned an invalid response." });
            }
        });
        client.on("timeout", () => { client.destroy(); finish({ ok: false, error: "The website blocker timed out." }); });
        client.on("error", () => finish({ ok: false, error: enforcementUnavailableMessage(platform) }));
    });
}
