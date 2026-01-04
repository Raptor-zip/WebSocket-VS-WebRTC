// DOM Elements
const wsStatus = document.getElementById('ws-status');
const rtcStatus = document.getElementById('rtc-status');
const startBtn = document.getElementById('btn-start');
const stopBtn = document.getElementById('btn-stop');

// WS
const wsRttEl = document.getElementById('ws-rtt');
const wsSentEl = document.getElementById('ws-sent');
const wsRecvEl = document.getElementById('ws-recv');
const wsMedEl = document.getElementById('ws-med');
const wsCol = document.getElementById('ws-col');

// RTC Unreliable
const rtcRttEl = document.getElementById('rtc-rtt');
const rtcSentEl = document.getElementById('rtc-sent');
const rtcRecvEl = document.getElementById('rtc-recv');
const rtcMedEl = document.getElementById('rtc-med');
const rtcCol = document.getElementById('rtc-col');

// RTC Reliable
const rtcRelRttEl = document.getElementById('rtc-rel-rtt');
const rtcRelSentEl = document.getElementById('rtc-rel-sent');
const rtcRelRecvEl = document.getElementById('rtc-rel-recv');
const rtcRelMedEl = document.getElementById('rtc-rel-med');
const rtcRelCol = document.getElementById('rtc-rel-col');

// Checkboxes
const chkWs = document.getElementById('chk-ws');
const chkRtcUnrel = document.getElementById('chk-rtc-unrel');
const chkRtcRel = document.getElementById('chk-rtc-rel');

// State
let ws = null;
let pc = null;
let dcUnrel = null;
let dcRel = null;
let isRunning = false;
let testInterval = null;
let pingCounter = 0;

let wsMetrics = { sent: 0, recv: 0, rttHistory: [], chartData: [] };
let rtcMetrics = { sent: 0, recv: 0, rttHistory: [], chartData: [] };
let rtcRelMetrics = { sent: 0, recv: 0, rttHistory: [], chartData: [] };

// Chart Setup
const ctx = document.getElementById('rttChart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'line',
    data: {
        datasets: [{
            label: 'WebSocket (TCP)',
            borderColor: 'rgb(75, 192, 192)',
            data: [],
            spanGaps: false
        }, {
            label: 'WebRTC (UDP/Unreliable)',
            borderColor: 'rgb(255, 99, 132)',
            data: [],
            spanGaps: false
        }, {
            label: 'WebRTC (UDP/Reliable)',
            borderColor: 'rgb(153, 102, 255)',
            data: [],
            spanGaps: false
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
            x: {
                type: 'linear',
                title: { display: true, text: 'Packet Sequence ID' }
            },
            y: {
                beginAtZero: true,
                title: { display: true, text: 'RTT (ms)' }
            }
        }
    }
});

// WebSocket Setup
function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
        wsStatus.textContent = 'Connected';
        wsStatus.classList.add('connected');
        checkReady();
    };

    ws.onclose = () => {
        wsStatus.textContent = 'Disconnected';
        wsStatus.classList.remove('connected');
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') {
            handlePong('ws', msg);
        }
    };
}

// WebRTC Setup
async function connectWebRTC() {
    pc = new RTCPeerConnection();

    // 1. Unreliable Channel (Ordered=false, Retransmits=0)
    dcUnrel = pc.createDataChannel('ping-pong-unrel', {
        ordered: false,
        maxRetransmits: 0
    });

    // 2. Reliable Channel (Ordered=true, Default)
    dcRel = pc.createDataChannel('ping-pong-rel', {
        ordered: true
    });

    const setupDC = (dc, label) => {
        dc.onopen = () => {
            checkReady();
        };
        dc.onclose = () => {
            rtcStatus.textContent = 'Disconnected';
            rtcStatus.classList.remove('connected');
        };
        dc.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'pong') {
                // Determine proto based on label
                const proto = (label === 'unrel') ? 'rtc' : 'rtc-rel';
                handlePong(proto, msg);
            }
        };
    };

    setupDC(dcUnrel, 'unrel');
    setupDC(dcRel, 'rel');

    // Negotiate
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch('/offer', {
        body: JSON.stringify({
            sdp: pc.localDescription.sdp,
            type: pc.localDescription.type
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
    });

    const answer = await response.json();
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

function checkReady() {
    const wsReady = ws && ws.readyState === WebSocket.OPEN;
    const rtcReady = dcUnrel && dcUnrel.readyState === 'open' &&
        dcRel && dcRel.readyState === 'open';

    if (wsReady) {
        wsStatus.classList.add('connected');
    }

    if (rtcReady) {
        rtcStatus.textContent = 'Connected (2 Channels)';
        rtcStatus.classList.add('connected');
    }

    if (wsReady && rtcReady) {
        startBtn.disabled = false;
    }
}


const MAX_SAMPLES = 100; // Rolling window size

// function updateStats (Helper)
function updateStats(elAvg, elMed, arr) {
    if (arr.length === 0) return;

    // Average
    const sum = arr.reduce((a, b) => a + b, 0);
    const avg = sum / arr.length;
    elAvg.textContent = avg.toFixed(2);

    // Median
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    elMed.textContent = med.toFixed(2);
}

// Update stats every 3 seconds
setInterval(() => {
    if (!isRunning) return;
    const now = Date.now();
    const windowStart = now - 3000;

    [wsMetrics, rtcMetrics, rtcRelMetrics].forEach((m, i) => {
        m.rttHistory = m.rttHistory.filter(item => item.t > windowStart);

        const values = m.rttHistory.map(item => item.v);

        let elAvg, elMed;
        if (i === 0) { elAvg = wsRttEl; elMed = wsMedEl; }
        else if (i === 1) { elAvg = rtcRttEl; elMed = rtcMedEl; }
        else { elAvg = rtcRelRttEl; elMed = rtcRelMedEl; }

        updateStats(elAvg, elMed, values);
    });
}, 3000);

function handlePong(proto, msg) {
    const now = Date.now();
    const rtt = now - msg.client_ts;
    // msg.id should be number now
    const packetId = typeof msg.id === 'string' ? parseInt(msg.id) : msg.id;

    let metrics, datasetIndex, elRecv, elCol;

    if (proto === 'ws') {
        metrics = wsMetrics;
        elRecv = wsRecvEl;
        elCol = wsCol;
        datasetIndex = 0;
    } else if (proto === 'rtc') { // Unreliable
        metrics = rtcMetrics;
        elRecv = rtcRecvEl;
        elCol = rtcCol;
        datasetIndex = 1;
    } else { // reliable
        metrics = rtcRelMetrics;
        elRecv = rtcRelRecvEl;
        elCol = rtcRelCol;
        datasetIndex = 2;
    }

    metrics.recv++;
    elRecv.textContent = metrics.recv;

    // Toggle Visual Feedback
    elCol.classList.toggle('tick');

    // Store for Stats (Time-based window)
    metrics.rttHistory.push({ t: now, v: rtt });

    // Chart Data (Packet ID vs RTT) -> Keep real-time update
    if (!metrics.chartData) metrics.chartData = [];
    metrics.chartData.push({ x: packetId, y: rtt });

    // Prune old chart data
    const limitId = pingCounter - MAX_SAMPLES - 10;
    while (metrics.chartData.length > 0 && metrics.chartData[0].x < limitId) {
        metrics.chartData.shift();
    }

    chart.data.datasets[datasetIndex].data = metrics.chartData;

    // Update X-Axis
    chart.options.scales.x.min = Math.max(0, pingCounter - MAX_SAMPLES);
    chart.options.scales.x.max = Math.max(MAX_SAMPLES, pingCounter);

    chart.update('none');
}


const selSize = document.getElementById('sel-size');
const lblPacketSize = document.getElementById('lbl-packet-size');

// Generate padding string
function getPadding(size) {
    if (size <= 0) return undefined;
    return 'X'.repeat(size);
}

// Test Loop
startBtn.onclick = () => {
    isRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    selSize.disabled = true;

    // Reset metrics
    pingCounter = 0;
    // Initial chartData init
    wsMetrics = { sent: 0, recv: 0, rttHistory: [], chartData: [] };
    rtcMetrics = { sent: 0, recv: 0, rttHistory: [], chartData: [] };
    rtcRelMetrics = { sent: 0, recv: 0, rttHistory: [], chartData: [] };

    // Clear Chart
    chart.data.datasets[0].data = [];
    chart.data.datasets[1].data = [];
    chart.data.datasets[2].data = [];
    chart.options.scales.x.min = 0;
    chart.options.scales.x.max = MAX_SAMPLES;
    chart.update();

    testInterval = setInterval(() => {
        if (!isRunning) return;

        pingCounter++;
        const ts = Date.now();
        const paddingSize = parseInt(selSize.value) || 0;

        const payload = {
            type: 'ping',
            id: pingCounter, // Sequential ID
            ts: ts
        };

        if (paddingSize > 0) {
            payload.payload = getPadding(paddingSize);
        }

        const msg = JSON.stringify(payload);
        lblPacketSize.textContent = msg.length;

        // Send WS
        if (ws && ws.readyState === WebSocket.OPEN && chkWs.checked) {
            ws.send(msg);
            wsMetrics.sent++;
            wsSentEl.textContent = wsMetrics.sent;
        }

        // Send WebRTC Unreliable
        if (dcUnrel && dcUnrel.readyState === 'open' && chkRtcUnrel.checked) {
            try {
                dcUnrel.send(msg);
                rtcMetrics.sent++;
                rtcSentEl.textContent = rtcMetrics.sent;
            } catch (e) {
                // Buffer full?
            }
        }

        // Send WebRTC Reliable
        if (dcRel && dcRel.readyState === 'open' && chkRtcRel.checked) {
            try {
                dcRel.send(msg);
                rtcRelMetrics.sent++;
                rtcRelSentEl.textContent = rtcRelMetrics.sent;
            } catch (e) {
                // Buffer full?
            }
        }

    }, parseInt(document.getElementById('inp-interval').value) || 100);
};

stopBtn.onclick = () => {
    isRunning = false;
    clearInterval(testInterval);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    selSize.disabled = false;
};

// Initialize
connectWS();
connectWebRTC();

// Persistence
function loadState() {
    const sWs = localStorage.getItem('chk-ws');
    const sUnrel = localStorage.getItem('chk-rtc-unrel');
    const sRel = localStorage.getItem('chk-rtc-rel');

    if (sWs !== null) chkWs.checked = (sWs === 'true');
    if (sUnrel !== null) chkRtcUnrel.checked = (sUnrel === 'true');
    if (sRel !== null) chkRtcRel.checked = (sRel === 'true');
}

function saveState() {
    localStorage.setItem('chk-ws', chkWs.checked);
    localStorage.setItem('chk-rtc-unrel', chkRtcUnrel.checked);
    localStorage.setItem('chk-rtc-rel', chkRtcRel.checked);
}

[chkWs, chkRtcUnrel, chkRtcRel].forEach(cb => {
    cb.addEventListener('change', saveState);
});

loadState();
