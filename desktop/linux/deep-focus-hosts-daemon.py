#!/usr/bin/env python3
"""Root-owned domain-tree blocker for Deep Focus.

The socket protocol intentionally supports activation only. An active deadline can
be extended, never shortened, blocked roots can only be added, and allowed
subdomain exceptions can only be removed until it expires.
"""

import ipaddress
import json
import os
import re
import signal
import socket
import struct
import subprocess
import threading
import time
from pathlib import Path

SOCKET_PATH = Path("/run/deep-focus.sock")
STATE_PATH = Path("/var/lib/deep-focus/state.json")
HOSTS_PATH = Path("/etc/hosts")
DNSMASQ_PATH = Path("/usr/sbin/dnsmasq")
DNSMASQ_CONFIG_PATH = Path("/run/deep-focus-dnsmasq.conf")
UPSTREAM_RESOLV_PATH = Path("/run/systemd/resolve/resolv.conf")
IP_PATH = Path("/usr/sbin/ip")
RESOLVECTL_PATH = Path("/usr/bin/resolvectl")
DNS_INTERFACE = "dfocusdns0"
# TEST-NET-1 is reserved for documentation and cannot collide with an Internet
# host. The address also gives this dummy link a usable DNS scope in resolved.
DNS_ADDRESS = "192.0.2.53"
DNS_ADDRESS_WITH_PREFIX = f"{DNS_ADDRESS}/32"
START_MARKER = "# DEEP FOCUS START - managed, do not edit"
END_MARKER = "# DEEP FOCUS END"
DOMAIN = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
lock = threading.RLock()
state = {"endsAtMillis": 0, "domains": [], "allowedDomains": [], "ownerUid": None}
dnsmasq_process = None
upstream_servers_snapshot = ()
running = True


def load_state():
    global state
    try:
        loaded = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        state = {
            "endsAtMillis": int(loaded.get("endsAtMillis", 0)),
            "domains": list(loaded.get("domains", [])),
            "allowedDomains": list(loaded.get("allowedDomains", [])),
            "ownerUid": loaded.get("ownerUid"),
        }
    except (FileNotFoundError, ValueError, TypeError, json.JSONDecodeError):
        pass


def persist_state():
    STATE_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = STATE_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(state), encoding="utf-8")
    os.chmod(temp, 0o600)
    temp.replace(STATE_PATH)


def without_managed_section(text):
    lines = text.splitlines()
    output = []
    managed = False
    for line in lines:
        if line.strip() == START_MARKER:
            managed = True
            continue
        if line.strip() == END_MARKER:
            managed = False
            continue
        if not managed:
            output.append(line)
    return "\n".join(output).rstrip() + "\n"


def write_hosts(domains):
    original = HOSTS_PATH.read_text(encoding="utf-8")
    clean = without_managed_section(original)
    if domains:
        section = "\n".join([START_MARKER, *[f"0.0.0.0 {domain}" for domain in domains], END_MARKER])
        clean = f"{clean}\n{section}\n"
    with HOSTS_PATH.open("w", encoding="utf-8") as hosts:
        hosts.write(clean)
        hosts.flush()
        os.fsync(hosts.fileno())


def is_strict_subdomain(hostname, domain):
    return hostname.endswith(f".{domain}")


def read_upstream_servers():
    servers = []
    for line in UPSTREAM_RESOLV_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) != 2 or parts[0] != "nameserver":
            continue
        address = parts[1].split("%", 1)[0]
        try:
            if not ipaddress.ip_address(address).is_loopback:
                servers.append(parts[1])
        except ValueError:
            continue
    if not servers:
        raise RuntimeError("No non-loopback upstream DNS server is available.")
    return tuple(dict.fromkeys(servers))


def build_dnsmasq_config(domains, allowed_domains, upstream_servers):
    lines = [
        "port=53",
        f"listen-address={DNS_ADDRESS}",
        "bind-interfaces",
        "no-hosts",
        "no-resolv",
        "cache-size=0",
    ]
    lines.extend(f"server={server}" for server in upstream_servers)
    lines.extend(f"address=/{domain}/#" for domain in sorted(domains))
    # dnsmasq uses the most-specific domain rule, so these exceptions are
    # forwarded to the machine's ordinary upstream resolvers.
    lines.extend(f"server=/{domain}/#" for domain in sorted(allowed_domains))
    return "\n".join(lines) + "\n"


def run_checked(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True, check=False)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()[:240]
        raise RuntimeError(detail or f"Command failed: {arguments[0]}")


def stop_dnsmasq():
    global dnsmasq_process
    if dnsmasq_process is None:
        return
    dnsmasq_process.terminate()
    try:
        dnsmasq_process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        dnsmasq_process.kill()
        dnsmasq_process.wait(timeout=1)
    dnsmasq_process = None


def remove_dns_route():
    subprocess.run([str(RESOLVECTL_PATH), "revert", DNS_INTERFACE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    subprocess.run([str(IP_PATH), "link", "delete", DNS_INTERFACE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    subprocess.run([str(RESOLVECTL_PATH), "flush-caches"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def start_dns_policy(domains, allowed_domains):
    global dnsmasq_process, upstream_servers_snapshot
    upstream_servers = read_upstream_servers()
    DNSMASQ_CONFIG_PATH.write_text(build_dnsmasq_config(domains, allowed_domains, upstream_servers), encoding="utf-8")
    os.chmod(DNSMASQ_CONFIG_PATH, 0o600)
    stop_dnsmasq()
    if subprocess.run([str(IP_PATH), "link", "show", DNS_INTERFACE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode:
        run_checked([str(IP_PATH), "link", "add", DNS_INTERFACE, "type", "dummy"])
    run_checked([str(IP_PATH), "address", "replace", DNS_ADDRESS_WITH_PREFIX, "dev", DNS_INTERFACE])
    run_checked([str(IP_PATH), "link", "set", DNS_INTERFACE, "up"])
    dnsmasq_process = subprocess.Popen(
        [str(DNSMASQ_PATH), "--keep-in-foreground", f"--conf-file={DNSMASQ_CONFIG_PATH}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.1)
    if dnsmasq_process.poll() is not None:
        dnsmasq_process = None
        raise RuntimeError(f"Could not start the Deep Focus DNS resolver on {DNS_ADDRESS}:53.")
    run_checked([str(RESOLVECTL_PATH), "dns", DNS_INTERFACE, DNS_ADDRESS])
    run_checked([str(RESOLVECTL_PATH), "domain", DNS_INTERFACE, *[f"~{domain}" for domain in sorted(domains)]])
    run_checked([str(RESOLVECTL_PATH), "default-route", DNS_INTERFACE, "no"])
    run_checked([str(RESOLVECTL_PATH), "flush-caches"])
    upstream_servers_snapshot = upstream_servers


def refresh_upstreams_if_needed():
    if not state["endsAtMillis"]:
        return
    try:
        current = read_upstream_servers()
    except (OSError, RuntimeError):
        return
    if current != upstream_servers_snapshot:
        start_dns_policy(state["domains"], state.get("allowedDomains", []))


def apply_policy(domains, allowed_domains):
    write_hosts(domains)
    if domains:
        try:
            start_dns_policy(domains, allowed_domains)
        except Exception:
            stop_dnsmasq()
            remove_dns_route()
            raise
    else:
        stop_dnsmasq()
        remove_dns_route()
        DNSMASQ_CONFIG_PATH.unlink(missing_ok=True)


def expire_if_due():
    with lock:
        if state["endsAtMillis"] and state["endsAtMillis"] <= int(time.time() * 1000):
            apply_policy([], [])
            state.update({"endsAtMillis": 0, "domains": [], "allowedDomains": [], "ownerUid": None})
            persist_state()


def peer_uid(connection):
    credentials = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", credentials)[1]


def activate(payload, uid):
    ends_at = int(payload.get("endsAtMillis", 0))
    requested = sorted(set(str(item).lower().rstrip(".") for item in payload.get("domains", [])))
    requested_allowed = sorted(set(str(item).lower().rstrip(".") for item in payload.get("allowedDomains", [])))
    if ends_at <= int(time.time() * 1000):
        raise ValueError("The focus deadline must be in the future.")
    if any(not DOMAIN.fullmatch(domain) for domain in requested):
        raise ValueError("Every blocklist entry must be a valid domain.")
    if any(not DOMAIN.fullmatch(domain) for domain in requested_allowed):
        raise ValueError("Every whitelist entry must be a valid subdomain.")
    if any(not any(is_strict_subdomain(domain, blocked) for blocked in requested) for domain in requested_allowed):
        raise ValueError("Every whitelist entry must be inside a blocked domain.")

    with lock:
        expire_if_due()
        owner = state.get("ownerUid")
        if owner is not None and owner != uid:
            raise PermissionError("A different local user owns the active focus session.")
        if state["endsAtMillis"]:
            next_ends_at = max(state["endsAtMillis"], ends_at)
            next_domains = sorted(set(state["domains"]) | set(requested))
            # An active policy may become stricter, never weaker: blocked roots
            # can be added, while allowed exceptions can only be removed.
            next_allowed = sorted(set(state.get("allowedDomains", [])) & set(requested_allowed))
        else:
            next_ends_at = ends_at
            next_domains = requested
            next_allowed = requested_allowed
        apply_policy(next_domains, next_allowed)
        state.update({"endsAtMillis": next_ends_at, "domains": next_domains, "allowedDomains": next_allowed, "ownerUid": uid})
        persist_state()


def handle(connection):
    try:
        raw = b""
        while b"\n" not in raw and len(raw) < 65536:
            chunk = connection.recv(4096)
            if not chunk:
                break
            raw += chunk
        payload = json.loads(raw.split(b"\n", 1)[0].decode("utf-8"))
        if payload.get("command") != "activate":
            raise ValueError("Only the activate command is supported.")
        activate(payload, peer_uid(connection))
        response = {"ok": True, "endsAtMillis": state["endsAtMillis"], "domainCount": len(state["domains"]), "allowedDomainCount": len(state["allowedDomains"])}
    except Exception as error:  # Return a bounded message across the local IPC boundary.
        response = {"ok": False, "error": str(error)[:240]}
    connection.sendall((json.dumps(response) + "\n").encode("utf-8"))
    connection.close()


def stop(_signal, _frame):
    global running
    running = False


def main():
    if os.geteuid() != 0:
        raise SystemExit("deep-focus-hosts-daemon must run as root")
    for dependency in (DNSMASQ_PATH, IP_PATH, RESOLVECTL_PATH, UPSTREAM_RESOLV_PATH):
        if not dependency.exists():
            raise SystemExit(f"Required Linux resolver dependency is missing: {dependency}")
    load_state()
    expire_if_due()
    if state["endsAtMillis"]:
        apply_policy(state["domains"], state.get("allowedDomains", []))
    SOCKET_PATH.unlink(missing_ok=True)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(SOCKET_PATH))
    os.chmod(SOCKET_PATH, 0o666)
    server.listen(8)
    server.settimeout(1)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while running:
            expire_if_due()
            refresh_upstreams_if_needed()
            try:
                connection, _ = server.accept()
                threading.Thread(target=handle, args=(connection,), daemon=True).start()
            except socket.timeout:
                pass
    finally:
        server.close()
        SOCKET_PATH.unlink(missing_ok=True)
        stop_dnsmasq()
        remove_dns_route()


if __name__ == "__main__":
    main()
