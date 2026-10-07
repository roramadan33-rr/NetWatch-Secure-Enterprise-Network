# What was corrected before publishing

## Code
- `app.js`: the fault analyzer was called by a name that did not exist (`renderAIFaultAnalyzer`), so the panel never rendered. Fixed.
- `app.js`: simulated users used different field names than the renderer expects (showed "undefined"). Fixed; demo devices now match the backend's 10 devices.
- `app.js`: data from `data.json` is escaped before `innerHTML`; the dashboard now says when data is sample/simulated; HSRP rule uses the alert's own message; demo-credential warning added.
- `network_monitor.py`: works on Linux and Windows; non-UTF-8 console output no longer marks a device offline; latency parsing handles `time<1ms` and localized output.
- `network_monitor.py`: AD users and DHCP usage are queried through PowerShell with a sample-data fallback (previously always hard-coded); HSRP and firewall alerts are derived from ping results instead of being hard-coded "OK" messages.
- `index.html`: server IP corrected to 192.168.60.100.

## Report (`Full_Report_corrected.pdf`)
Statements aligned with what the dashboard actually does (sections 4.2, 4.4, 4.4.1, 4.4.6, Table 8, 4.7, 4.8, 5.2, 5.4, 5.4 item 5, 6): no "firewall events", traffic chart marked as simulated, uptime/device-count claim removed (the captured dashboard shows 10 devices, 8 offline), VPN described as supported by FortiGate but not deployed, "100%" goal claim softened.
