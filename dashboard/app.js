const vlans = [
  { name: 'Sales', id: 10, subnet: '192.168.10.0/24', gw: '192.168.10.1', color: 'var(--sales)' },
  { name: 'HR', id: 20, subnet: '192.168.20.0/24', gw: '192.168.20.1', color: 'var(--hr)' },
  { name: 'Finance', id: 30, subnet: '192.168.30.0/24', gw: '192.168.30.1', color: 'var(--finance)' },
  { name: 'Manager', id: 40, subnet: '192.168.40.0/24', gw: '192.168.40.1', color: 'var(--manager)' },
  { name: 'IT', id: 50, subnet: '192.168.50.0/24', gw: '192.168.50.1', color: 'var(--it)' },
  { name: 'Servers', id: 60, subnet: '192.168.60.0/24', gw: '192.168.60.1', color: 'var(--servers)' },
];

const deptColors = {
  Sales: 'var(--sales)', HR: 'var(--hr)', Finance: 'var(--finance)',
  Manager: 'var(--manager)', IT: 'var(--it)', default: 'var(--servers)'
};

let trafficHistory = Array(14).fill(null).map(() => ({ i: 0, o: 0 }));
let isDemoMode = false;

function rnd(a, b) { return Math.round(Math.random() * (b - a) + a); }

// Escape text coming from data.json before putting it into innerHTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadData() {
  try {
    const res = await fetch('data.json?t=' + Date.now());
    if (!res.ok) throw new Error('data.json not found');
    const data = await res.json();
    isDemoMode = false;
    renderData(data);
  } catch (e) {
    isDemoMode = true;
    renderSimulated();
  }
}

function renderData(data) {
  const devices = data.devices || [];
  const users = data.users || [];
  const alerts = data.alerts || [];
  const services = data.services || [];

  renderDevices(devices);
  renderUsers(users);
  renderAlerts(alerts);
  updateMetrics(devices, users);
  renderInfrastructure(services);
  renderRuleBasedFaultAnalyzer(devices, alerts);

  document.getElementById('last-update').textContent = data.timestamp || new Date().toLocaleTimeString();

  // UI Data Source Update
  const sourceEl = document.getElementById('data-source-label');
  if (sourceEl) {
    const src = data.sources || {};
    if (isDemoMode) {
      sourceEl.innerHTML = '<span style="color:var(--amber);">SIMULATED (No Python Backend)</span>';
    } else if (src.ping === 'sample') {
      sourceEl.innerHTML = '<span style="color:var(--amber);">SAMPLE SNAPSHOT (data.json)</span>';
    } else {
      const sampled = ['ad', 'dhcp'].filter(k => src[k] && src[k] !== 'live');
      sourceEl.innerHTML = '<span style="color:var(--green);">LIVE Python Backend</span>' +
        (sampled.length ? ' <span style="color:var(--amber);">(' + sampled.map(k => k.toUpperCase()).join('/') + ': sample)</span>' : '');
    }
  }
}

function renderSimulated() {
  // Same device list and data shape as network_monitor.py, so the demo matches the live backend
  const simDevices = [
    { name: 'FortiGate FW-1', ip: '10.0.0.1', up: true, ping: rnd(1, 5) },
    { name: 'Windows Server', ip: '192.168.60.100', up: true, ping: rnd(1, 3) },
    { name: 'IOU1 Core SW', ip: '10.0.1.2', up: true, ping: rnd(2, 12) },
    { name: 'IOU2 Core SW', ip: '10.0.2.2', up: true, ping: rnd(2, 16) },
    { name: 'R1 Router', ip: '192.168.60.20', up: Math.random() > 0.15, ping: rnd(10, 35) },
    { name: 'Sales-1 PC', ip: '192.168.10.10', up: Math.random() > 0.1, ping: rnd(15, 45) },
    { name: 'HR-1 PC', ip: '192.168.20.10', up: Math.random() > 0.1, ping: rnd(10, 30) },
    { name: 'Finance-1 PC', ip: '192.168.30.10', up: Math.random() > 0.1, ping: rnd(10, 25) },
    { name: 'Manager-1 PC', ip: '192.168.40.10', up: true, ping: rnd(8, 20) },
    { name: 'IT-1 PC', ip: '192.168.50.10', up: true, ping: rnd(5, 18) },
  ].map(d => ({ name: d.name, ip: d.ip, status: d.up ? 'online' : 'offline', ping: d.up ? d.ping : 0 }));

  const simUsers = [
    { name: 'Ahmed Adel', department: 'Finance', time: '08:30' },
    { name: 'Sara Mohamed', department: 'HR', time: '09:15' },
    { name: 'Khaled Hassan', department: 'IT', time: '07:45' },
    { name: 'Mona Ibrahim', department: 'Sales', time: '09:00' },
    { name: 'Omar Tarek', department: 'Manager', time: '08:00' },
  ];

  const now = new Date().toLocaleTimeString();
  const simAlerts = simDevices
    .filter(d => d.status === 'offline')
    .map(d => ({ type: 'err', title: `Device Offline: ${d.name}`, msg: `IP ${d.ip} is not responding to ICMP.`, time: now }));

  // Occasionally simulate an HSRP failover event
  if (Math.random() > 0.8) {
    simAlerts.unshift({ type: 'warn', title: 'HSRP State Change (inferred)', msg: 'IOU1 unreachable; IOU2 is expected to have taken over as active.', time: now });
  } else {
    simAlerts.unshift({ type: 'info', title: 'HSRP Redundancy Ready (inferred)', msg: 'IOU1 and IOU2 both reachable.', time: 'stable' });
  }
  simAlerts.unshift({ type: 'ok', title: 'Firewall Reachable', msg: 'FortiGate FW-1 is responding to ICMP.', time: 'running' });

  const simServices = {
    dhcpPools: [
      { name: 'VLAN 10', used: rnd(40, 80), color: 'var(--sales)' },
      { name: 'VLAN 20', used: rnd(10, 30), color: 'var(--hr)' },
      { name: 'VLAN 30', used: rnd(20, 50), color: 'var(--finance)' },
      { name: 'VLAN 40', used: rnd(5, 15), color: 'var(--manager)' },
      { name: 'VLAN 50', used: rnd(30, 90), color: 'var(--it)' },
    ],
    coreLoad: rnd(10, 45),
    memLoad: rnd(30, 60),
  };

  renderData({
    devices: simDevices,
    users: simUsers,
    alerts: simAlerts,
    services: simServices,
    sources: { ping: 'simulated', ad: 'simulated', dhcp: 'simulated' },
    timestamp: now,
  });
}

// RULE-BASED FAULT ANALYZER
function renderRuleBasedFaultAnalyzer(devices, alerts) {
  const aiList = document.getElementById('ai-fault-list');
  let analysis = [];

  // Rule 1: Offline Devices
  const offline = devices.filter(d => d.status === 'offline');
  offline.forEach(d => {
    analysis.push({
      type: 'critical',
      issue: `Device Offline: ${d.name}`,
      cause: 'VLAN misconfiguration, power loss, or physical link failure.',
      action: 'Check switch port status, verify IP configuration, and test physical connectivity.'
    });
  });

  // Rule 2: High Latency
  const highPing = devices.filter(d => d.status === 'online' && d.ping >= 30);
  highPing.forEach(d => {
    analysis.push({
      type: 'warn',
      issue: `High Latency: ${d.name} (${d.ping}ms)`,
      cause: 'Bandwidth saturation, routing loop, or CPU starvation.',
      action: 'Check interface utilization, verify QoS policies, and monitor CPU.'
    });
  });

  // Rule 3: HSRP / core-layer alerts raised by the backend
  alerts.filter(a => a.title && a.title.includes('HSRP') && a.type === 'warn').forEach(a => {
    analysis.push({
      type: 'critical',
      issue: a.title,
      cause: a.msg,
      action: 'Check IOU1/IOU2 logs and interface status, verify L2 adjacency and EtherChannel, then confirm which switch is HSRP active.'
    });
  });

  // Rule 4: System Healthy
  if (analysis.length === 0) {
    analysis.push({
      type: 'ok',
      issue: 'Infrastructure Optimal',
      cause: 'All monitored systems are operating within nominal parameters.',
      action: 'No action required.'
    });
  }

  aiList.innerHTML = analysis.map(a => `
    <div class="ai-item ${a.type}">
      <div class="ai-issue">${esc(a.issue)}</div>
      <div class="ai-cause">${a.cause}</div>
      <div class="ai-action">${a.action}</div>
    </div>
  `).join('');
}

function renderDevices(devices) {
  const online = devices.filter(d => d.status === 'online');
  const offline = devices.filter(d => d.status === 'offline');
  const el = document.getElementById('ping-status');

  if (offline.length === 0) {
    el.textContent = 'ALL SYSTEMS GO';
    el.className = 'tag green';
  } else {
    el.textContent = `${offline.length} OFFLINE`;
    el.className = 'tag red';
  }

  document.getElementById('devices-grid').innerHTML = devices.map(d => {
    const pingScore = d.ping || 0;
    const pct = Math.min((pingScore / 50) * 100, 100);
    const cls = pingScore < 15 ? 'good' : pingScore < 30 ? 'warn' : 'bad';

    return `
    <div class="device-card ${d.status === 'offline' ? 'offline' : ''}">
      <div class="device-top">
        <div class="device-name">${esc(d.name)}</div>
        <span class="status-pill ${d.status}">${d.status === 'online' ? 'ONLINE' : 'OFFLINE'}</span>
      </div>
      <div class="device-ip">${esc(d.ip)}</div>
      ${d.status === 'online'
        ? `<div class="ping-row">
            <span class="ping-label">PING</span>
            <div class="ping-track"><div class="ping-fill ${cls}" style="width:${pct}%"></div></div>
            <span class="ping-val">${pingScore}ms</span>
           </div>`
        : `<div style="font-size:11px;color:var(--red);font-family:var(--font-mono);margin-top:8px;">— no response —</div>`}
    </div>`;
  }).join('');
}

function renderUsers(users) {
  if (!users || users.length === 0) return;
  document.getElementById('users-grid').innerHTML = users.map(u => {
    const dept = u.department || 'Unknown';
    const col = deptColors[dept] || deptColors.default;
    const init = (u.name || '??').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    return `
    <div class="user-row">
      <div class="user-avatar" style="background:${col}11; color:${col}; border-color:${col}44;">${init}</div>
      <div style="flex:1;">
        <div class="user-name">${esc(u.name)}</div>
        <div class="user-dept" style="color:${col};">${esc(dept)}</div>
      </div>
      <div class="user-ip">${esc(u.time || 'N/A')}</div>
    </div>`;
  }).join('');
}

function renderInfrastructure(services) {
  if (!services || !services.dhcpPools) return;

  document.getElementById('dhcp-pools').innerHTML = services.dhcpPools.map(pool => `
        <div class="dhcp-row">
            <div class="dhcp-circle" style="background: ${pool.color}"></div>
            <div class="dhcp-vlan" style="color: ${pool.color}">${pool.name}</div>
            <div class="dhcp-bar-wrap">
                <div class="dhcp-bar" style="background: ${pool.color}; width: ${pool.used}%"></div>
            </div>
            <div class="dhcp-pct">${pool.used}%</div>
        </div>
    `).join('');

  if (document.getElementById('infra-cpu')) {
    document.getElementById('infra-cpu').textContent = services.coreLoad + '%';
    document.getElementById('infra-mem').textContent = services.memLoad + '%';
  }
}

function renderAlerts(alerts) {
  document.getElementById('alert-count').textContent = `${alerts.length} events`;
  if (alerts.length === 0) return;

  document.getElementById('alerts-list').innerHTML = alerts.slice(0, 8).map(a => `
    <div class="alert-item ${a.type || 'info'}">
      <div style="width:100%">
        <div class="alert-title">${esc(a.title)}</div>
        <div class="alert-msg">${esc(a.msg)}</div>
        <div class="alert-time">${esc(a.time)}</div>
      </div>
    </div>
  `).join('');
}

function updateMetrics(devices, users) {
  const online = devices.filter(d => d.status === 'online');
  const offline = devices.filter(d => d.status === 'offline');
  const avgPing = online.length > 0
    ? Math.round(online.reduce((s, d) => s + (d.ping || 0), 0) / online.length)
    : 0;

  document.getElementById('m-total').textContent = devices.length;
  document.getElementById('m-online').textContent = online.length;
  document.getElementById('m-offline').textContent = offline.length;
  document.getElementById('m-ping').textContent = avgPing + 'ms';
  document.getElementById('m-users').textContent = (users || []).length;
}

function renderVlans() {
  // Currently unused in new single-screen layout to save space, keeping for completeness
}

function renderTraffic() {
  const inV = rnd(15, 60);
  const outV = rnd(10, 40);
  trafficHistory.push({ i: inV, o: outV });
  trafficHistory.shift();

  const maxV = Math.max(...trafficHistory.map(t => Math.max(t.i, t.o)), 1);

  document.getElementById('chart-wrap').innerHTML = trafficHistory.map(t => `
    <div class="chart-col">
      <div class="chart-bar in"  style="height:${Math.round((t.i / maxV) * 85)}%;"></div>
      <div class="chart-bar out" style="height:${Math.round((t.o / maxV) * 85)}%;"></div>
    </div>
  `).join('');

  document.getElementById('traffic-label').textContent = `SIM  IN: ${inV} | OUT: ${outV} Mbps`;
}

function updateClock() {
  const t = new Date();
  document.getElementById('clock').textContent = t.toLocaleTimeString('en-GB');
}

// LOGIN & AUTH LOGIC
// DEMO ONLY: this login runs in the browser, so anyone can read these values in the
// page source. It demonstrates the UI flow and is NOT real authentication.
const VALID_USERS = [
  { username: 'admin', password: '1234@' },
  { username: 'roaa', password: '1234@' },
  { username: 'network', password: '1234@' },
];

function triggerLogin() {
  const user = document.getElementById('login-user').value.trim().toLowerCase();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');

  const valid = VALID_USERS.find(u => u.username === user && u.password === pass);

  if (valid) {
    const loginPage = document.getElementById('login-page');
    loginPage.style.opacity = '0';
    loginPage.style.visibility = 'hidden';

    sessionStorage.setItem('nw-auth', '1');
    sessionStorage.setItem('nw-user', user);

    startDashboard();
  } else {
    err.classList.add('show');
    document.getElementById('login-pass').value = '';
    setTimeout(() => err.classList.remove('show'), 3000);
  }
}

function triggerLogout() {
  sessionStorage.removeItem('nw-auth');
  sessionStorage.removeItem('nw-user');

  const loginPage = document.getElementById('login-page');
  loginPage.style.visibility = 'visible';
  loginPage.style.opacity = '1';

  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';

  if (window.dashIntervals) {
    window.dashIntervals.forEach(clearInterval);
    window.dashIntervals = [];
  }
}

function startDashboard() {
  loadData();
  renderTraffic();
  updateClock();

  window.dashIntervals = [
    setInterval(loadData, 10000), // Speed up mock for dynamic testing
    setInterval(renderTraffic, 4000),
    setInterval(updateClock, 1000)
  ];
}

document.getElementById('login-btn').addEventListener('click', triggerLogin);
document.getElementById('logout-btn').addEventListener('click', triggerLogout);
document.getElementById('refresh-btn').addEventListener('click', () => { loadData(); renderTraffic(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const loginPage = document.getElementById('login-page');
    if (getComputedStyle(loginPage).opacity === '1') {
      triggerLogin();
    }
  }
});

if (sessionStorage.getItem('nw-auth') === '1') {
  const loginPage = document.getElementById('login-page');
  loginPage.style.transition = 'none';
  loginPage.style.opacity = '0';
  loginPage.style.visibility = 'hidden';

  setTimeout(() => loginPage.style.transition = 'opacity 0.5s ease, visibility 0.5s ease', 100);
  startDashboard();
}
