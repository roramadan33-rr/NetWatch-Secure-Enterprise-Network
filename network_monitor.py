"""
NetWatch backend: polls the lab devices and writes data.json for the dashboard.

What is LIVE vs SAMPLE
    * Device status / latency ........ live (ICMP ping)
    * Alerts ......................... derived from the ping results
    * HSRP / firewall status ......... INFERRED from ping reachability of
                                       IOU1 / IOU2 / FortiGate (no HSRP query)
    * AD users ....................... live via PowerShell Get-ADUser when this
                                       script runs on the domain controller (or a
                                       machine with RSAT); otherwise sample data
    * DHCP pool usage ................ live via PowerShell when the DHCP Server
                                       role is reachable; otherwise sample data
The "sources" block in data.json tells the dashboard which parts are live.

Usage
    python network_monitor.py                  # loop forever, write ./data.json
    python network_monitor.py --once           # single scan then exit
    python network_monitor.py --output C:\\inetpub\\wwwroot\\data.json --interval 10
"""
import argparse
import json
import os
import platform
import re
import subprocess
import threading
import time
from datetime import datetime

try:
    import psutil
except ImportError:
    psutil = None

IS_WINDOWS = platform.system() == "Windows"

DEVICES = [
    {"name": "FortiGate FW-1", "ip": "10.0.0.1"},
    {"name": "Windows Server", "ip": "192.168.60.100"},
    {"name": "IOU1 Core SW",   "ip": "10.0.1.2"},
    {"name": "IOU2 Core SW",   "ip": "10.0.2.2"},
    {"name": "R1 Router",      "ip": "192.168.60.20"},
    {"name": "Sales-1 PC",     "ip": "192.168.10.10"},
    {"name": "HR-1 PC",        "ip": "192.168.20.10"},
    {"name": "Finance-1 PC",   "ip": "192.168.30.10"},
    {"name": "Manager-1 PC",   "ip": "192.168.40.10"},
    {"name": "IT-1 PC",        "ip": "192.168.50.10"},
]

VLAN_COLORS = {
    10: "var(--sales)", 20: "var(--hr)", 30: "var(--finance)",
    40: "var(--manager)", 50: "var(--it)", 60: "var(--servers)",
}

SAMPLE_USERS = [
    {"name": "Ahmed Adel",    "department": "Finance", "time": "08:30"},
    {"name": "Sara Mohamed",  "department": "HR",      "time": "09:15"},
    {"name": "Khaled Hassan", "department": "IT",      "time": "07:45"},
    {"name": "Mona Ibrahim",  "department": "Sales",   "time": "09:00"},
    {"name": "Omar Tarek",    "department": "Manager", "time": "08:00"},
]

SAMPLE_DHCP = [
    {"name": "VLAN 10", "used": 45, "color": "var(--sales)"},
    {"name": "VLAN 20", "used": 20, "color": "var(--hr)"},
    {"name": "VLAN 30", "used": 35, "color": "var(--finance)"},
    {"name": "VLAN 40", "used": 15, "color": "var(--manager)"},
    {"name": "VLAN 50", "used": 60, "color": "var(--it)"},
]

HIGH_LATENCY_MS = 30


# --------------------------------------------------------------------------
# Ping
# --------------------------------------------------------------------------
def parse_latency(output, fallback_ms):
    """Extract latency from ping output; fall back to wall-clock time.

    Windows ping output can be localized (e.g. Arabic Windows), in which case
    the "time=" label is not found and we use the measured wall-clock time.
    """
    m = re.search(r"time\s*([=<])\s*([\d.]+)\s*ms", output, re.IGNORECASE)
    if m:
        if m.group(1) == "<":
            return 1
        return max(1, int(round(float(m.group(2)))))
    return max(1, int(round(fallback_ms)))


def ping_device(device, results):
    """Ping one device once and store {name, ip, status, ping} in results[ip]."""
    ip = device["ip"]
    if IS_WINDOWS:
        cmd = ["ping", "-n", "1", "-w", "3000", ip]
    else:
        cmd = ["ping", "-c", "1", "-W", "3", ip]

    status, ping_ms = "offline", 0
    try:
        kwargs = {}
        if IS_WINDOWS:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            kwargs["startupinfo"] = startupinfo
        started = time.perf_counter()
        # errors="replace": non-UTF8 console output must not mark a device offline
        output = subprocess.check_output(
            cmd, stderr=subprocess.STDOUT, text=True, errors="replace",
            timeout=8, **kwargs)
        elapsed_ms = (time.perf_counter() - started) * 1000
        # A reply carries a TTL; "Destination host unreachable" replies do not.
        if "ttl=" in output.lower():
            status = "online"
            ping_ms = parse_latency(output, elapsed_ms)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        pass

    results[ip] = {"name": device["name"], "ip": ip, "status": status, "ping": ping_ms}


# --------------------------------------------------------------------------
# System / AD / DHCP
# --------------------------------------------------------------------------
def fetch_hardware_metrics():
    """CPU / RAM of the machine running this script (not of the network devices)."""
    if psutil:
        try:
            return int(psutil.cpu_percent(interval=None)), int(psutil.virtual_memory().percent), "live"
        except Exception:
            pass
    import random
    return random.randint(20, 80), random.randint(30, 90), "simulated"


def _run_powershell(script, timeout=15):
    out = subprocess.check_output(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        text=True, errors="replace", timeout=timeout, stderr=subprocess.DEVNULL)
    data = json.loads(out)
    return [data] if isinstance(data, dict) else data


def fetch_ad_users():
    """Return (users, source). Tries Get-ADUser; falls back to sample data."""
    script = (
        "Get-ADUser -Filter * -Properties Department,LastLogonDate | "
        "Where-Object { $_.Enabled } | "
        "Select-Object "
        "@{n='name';e={$_.Name}},"
        "@{n='department';e={if($_.Department){$_.Department}"
        "else{(($_.DistinguishedName -split ',')[1]) -replace '^OU=',''}}},"
        "@{n='time';e={if($_.LastLogonDate){$_.LastLogonDate.ToString('HH:mm')}else{'N/A'}}} | "
        "ConvertTo-Json -Compress"
    )
    try:
        rows = _run_powershell(script)
        users = [{
            "name": r.get("name") or "Unknown",
            "department": r.get("department") or "Unknown",
            "time": r.get("time") or "N/A",
        } for r in rows]
        if users:
            return users, "live"
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            OSError, ValueError, TypeError, AttributeError):
        pass
    return SAMPLE_USERS, "simulated"


def fetch_dhcp_stats():
    """Return (pools, source). Tries the DHCP Server cmdlets; falls back to sample data."""
    script = (
        "Get-DhcpServerv4ScopeStatistics | "
        "Select-Object @{n='scope';e={$_.ScopeId.ToString()}},"
        "@{n='used';e={[int][math]::Round($_.PercentageInUse)}} | "
        "ConvertTo-Json -Compress"
    )
    try:
        rows = _run_powershell(script)
        pools = []
        for r in rows:
            third_octet = int(str(r["scope"]).split(".")[2])
            pools.append({
                "name": f"VLAN {third_octet}",
                "used": int(r["used"]),
                "color": VLAN_COLORS.get(third_octet, "var(--servers)"),
            })
        if pools:
            return sorted(pools, key=lambda p: int(p["name"].split()[1])), "live"
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            OSError, ValueError, TypeError, KeyError, IndexError):
        pass
    return SAMPLE_DHCP, "simulated"


# --------------------------------------------------------------------------
# Alerts
# --------------------------------------------------------------------------
def generate_alerts(devices):
    """Build alerts from ping results only (nothing is hard-coded as 'OK')."""
    now = datetime.now().strftime("%I:%M:%S %p")
    by_name = {d["name"]: d for d in devices}
    alerts = []

    for d in devices:
        if d["status"] == "offline":
            alerts.append({"type": "err", "title": f"Device Offline: {d['name']}",
                           "msg": f"IP {d['ip']} is not responding to ICMP.", "time": now})
        elif d["ping"] >= HIGH_LATENCY_MS:
            alerts.append({"type": "warn", "title": f"High Latency: {d['name']}",
                           "msg": f"{d['ping']} ms to {d['ip']}.", "time": now})

    iou1 = by_name.get("IOU1 Core SW", {}).get("status")
    iou2 = by_name.get("IOU2 Core SW", {}).get("status")
    if iou1 == "offline" and iou2 == "online":
        alerts.append({"type": "warn", "title": "HSRP State Change (inferred)",
                       "msg": "IOU1 unreachable; IOU2 is expected to have taken over as active.", "time": now})
    elif iou1 == "online" and iou2 == "offline":
        alerts.append({"type": "warn", "title": "HSRP Standby Down (inferred)",
                       "msg": "IOU2 unreachable; gateway redundancy is lost.", "time": now})
    elif iou1 == "offline" and iou2 == "offline":
        alerts.append({"type": "err", "title": "Core Layer Down",
                       "msg": "Neither IOU1 nor IOU2 responds; inter-VLAN routing is likely down.", "time": now})
    elif iou1 == "online" and iou2 == "online":
        alerts.append({"type": "info", "title": "HSRP Redundancy Ready (inferred)",
                       "msg": "IOU1 and IOU2 both reachable. State is inferred from ping, not read from HSRP.",
                       "time": "stable"})

    if by_name.get("FortiGate FW-1", {}).get("status") == "online":
        alerts.append({"type": "ok", "title": "Firewall Reachable",
                       "msg": "FortiGate FW-1 is responding to ICMP.", "time": "running"})
    return alerts


# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------
def run_monitor(output_file):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Running network scan...")

    ping_results = {}
    threads = [threading.Thread(target=ping_device, args=(dev, ping_results)) for dev in DEVICES]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    devices = [ping_results.get(d["ip"], {"name": d["name"], "ip": d["ip"],
                                          "status": "offline", "ping": 0}) for d in DEVICES]

    cpu, mem, system_src = fetch_hardware_metrics()
    users, ad_src = fetch_ad_users()
    dhcp, dhcp_src = fetch_dhcp_stats()

    data = {
        "devices": devices,
        "users": users,
        "alerts": generate_alerts(devices),
        "services": {"coreLoad": cpu, "memLoad": mem, "dhcpPools": dhcp},
        "sources": {"ping": "live", "ad": ad_src, "dhcp": dhcp_src, "system": system_src},
        "timestamp": datetime.now().strftime("%I:%M:%S %p"),
    }

    temp_file = output_file + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)
    os.replace(temp_file, output_file)

    online = sum(1 for d in devices if d["status"] == "online")
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {online}/{len(devices)} online "
          f"(AD: {ad_src}, DHCP: {dhcp_src}) -> {output_file}")


def main():
    parser = argparse.ArgumentParser(description="NetWatch monitoring backend")
    parser.add_argument("--output", default="data.json", help="path of the JSON file to write")
    parser.add_argument("--interval", type=int, default=10, help="seconds between scans")
    parser.add_argument("--once", action="store_true", help="scan once and exit")
    args = parser.parse_args()

    if psutil is None:
        print("Note: install psutil (pip install psutil) for real CPU/RAM metrics.")
    else:
        psutil.cpu_percent(interval=None)  # prime the counter; first call always returns 0.0

    print(f"Starting NetWatch backend, writing to {args.output}")
    print(f"Monitoring {len(DEVICES)} devices every {args.interval} seconds.\n")

    while True:
        try:
            run_monitor(args.output)
            if args.once:
                break
            time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\nShutting down monitor...")
            break
        except Exception as e:  # keep the service alive on unexpected errors
            print(f"Error during execution: {e}")
            if args.once:
                raise
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
