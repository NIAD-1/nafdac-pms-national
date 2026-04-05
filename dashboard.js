/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v2 — NATIONAL INTELLIGENCE DASHBOARD
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, getDocs, query, limit, orderBy } from "./db.js";
import { clearRoot, showLoading, showToast } from "./ui.js";
import { ZONES, ALL_STATES, ACTIVITY_TYPES, ACTIVITY_KEYS, formatCurrency } from "./constants.js";
import { getUserScope } from "./auth.js";

// Global loaded data for client-side filtering
let allReports = [];
let allSanctions = [];
let allRevenueManual = [];
let filteredReports = [];
let filteredSanctions = [];
let filteredRevenue = [];

let dashboardMap = null;
let mapMarkers = [];

const NIGERIAN_STATES_COORD = {
    "Abia": [5.5320, 7.4860], "Adamawa": [9.3333, 12.5000], "Akwa Ibom": [5.0000, 7.8333],
    "Anambra": [6.2500, 7.0000], "Bauchi": [10.5000, 10.0000], "Bayelsa": [4.7500, 6.0833],
    "Benue": [7.3333, 8.7500], "Borno": [11.5000, 13.0000], "Cross River": [5.7500, 8.5000],
    "Delta": [5.5000, 6.0000], "Ebonyi": [6.2500, 8.0833], "Edo": [6.5000, 6.0000],
    "Ekiti": [7.6667, 5.2500], "Enugu": [6.5000, 7.5000], "FCT": [8.8333, 7.1667],
    "Gombe": [10.2500, 11.1667], "Imo": [5.4833, 7.0333], "Jigawa": [12.0000, 9.7500],
    "Kaduna": [10.3333, 7.7500], "Kano": [11.5000, 8.5000], "Katsina": [12.2500, 7.5000],
    "Kebbi": [11.5000, 4.0000], "Kogi": [7.5000, 6.6667], "Kwara": [8.5000, 4.5000],
    "Lagos": [6.5833, 3.3333], "Nasarawa": [8.5000, 8.0000], "Niger": [10.0000, 6.0000],
    "Ogun": [7.0000, 3.5833], "Ondo": [7.1667, 5.0833], "Osun": [7.5000, 4.5000],
    "Oyo": [8.0000, 4.0000], "Plateau": [9.1667, 9.7500], "Rivers": [4.7500, 6.8333],
    "Sokoto": [13.0833, 5.2500], "Taraba": [8.0000, 10.5000], "Yobe": [12.0000, 11.5000],
    "Zamfara": [12.1667, 6.2500]
};

export async function loadDashboard(root, dbInst, user, userData) {
    showLoading(root, 'Loading master intelligence data...');

    try {
        // We fetch a capped number of reports for client filtering to protect memory
        // Ordered natively to get the latest activities
        const rQuery = query(collection(db, 'facilityReports'), orderBy('createdAt', 'desc'), limit(500));
        const rSnap = await getDocs(rQuery);
        allReports = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const sQuery = query(collection(db, 'sanctions'), orderBy('createdAt', 'desc'), limit(500));
        const sSnap = await getDocs(sQuery); 
        allSanctions = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const revQuery = query(collection(db, 'revenue'), limit(500));
        const revSnap = await getDocs(revQuery); 
        allRevenueManual = revSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const scope = getUserScope();

        // Enforce user scope
        if (scope.state) {
            allReports = allReports.filter(r => r.state === scope.state);
            allSanctions = allSanctions.filter(s => s.state === scope.state);
            allRevenueManual = allRevenueManual.filter(s => s.state === scope.state);
        } else if (scope.zone) {
            allReports = allReports.filter(r => r.zone === scope.zone);
            allSanctions = allSanctions.filter(s => s.zone === scope.zone);
            allRevenueManual = allRevenueManual.filter(s => s.zone === scope.zone);
        }

        renderDashboardUI(root, userData);
        applyFilters();

    } catch (err) {
        console.error("Dashboard error:", err);
        root.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderDashboardUI(root, userData) {
    clearRoot(root);

    const actOptions = ACTIVITY_KEYS.map(k => `<option value="${k}">${ACTIVITY_TYPES[k].label}</option>`).join('');
    // Also include module keys that we know about
    const addlOptions = `
        <option value="log-complaints">Complaints Log</option>
        <option value="log-adverts">Adverts Log</option>
        <option value="log-rasff">RASFF Log</option>
        <option value="log-meetings">Meetings & QMS</option>
    `;

    const stateOptions = ALL_STATES.map(s => `<option value="${s}">${s}</option>`).join('');
    const zoneOptions = Object.keys(ZONES).map(z => `<option value="${z}">${z}</option>`).join('');

    const scope = getUserScope();

    root.innerHTML = `
    <div class="animate-fade-in">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
            <div>
                <h1 style="margin:0;">📊 National Intelligence Dashboard</h1>
                <p class="muted small">Filter actions, facilities, infractions and revenue.</p>
            </div>
            <button class="secondary" id="exportCsv">📥 Export CSV</button>
        </div>

        <!-- Filter Bar -->
        <div class="card" style="margin-bottom: 24px; padding: 20px;">
            <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:flex-end;">
                ${scope.zone || scope.state ? '' : `
                <div style="flex:1; min-width:150px;">
                    <label class="small muted">Zone</label>
                    <select id="filterZone" style="padding:8px;"><option value="">All Zones</option>${zoneOptions}</select>
                </div>`}
                ${scope.state ? '' : `
                <div style="flex:1; min-width:150px;">
                    <label class="small muted">State</label>
                    <select id="filterState" style="padding:8px;"><option value="">All States</option>${stateOptions}</select>
                </div>`}
                
                <div style="flex:1; min-width:180px;">
                    <label class="small muted">Activity Source</label>
                    <select id="filterActivity" style="padding:8px;">
                        <option value="">All Activities</option>
                        <option value="Routine Surveillance">Routine Surveillance</option>
                        <option value="Consumer Complaint">Consumer Complaint</option>
                        <option value="GLSI">GLSI Monitoring</option>
                        <option value="GSDP / CEVI">GSDP / CEVI</option>
                        <option value="Lab Report">Lab Report</option>
                        <option value="Consultative Meeting">Consultative Meeting</option>
                        <option value="RASFF">RASFF Log</option>
                        <option value="Adverts">Adverts Log</option>
                    </select>
                </div>
                <div style="flex:1; min-width:150px;">
                    <label class="small muted">From Date</label>
                    <input type="date" id="filterStart" style="padding:8px;">
                </div>
                <div style="flex:1; min-width:150px;">
                    <label class="small muted">To Date</label>
                    <input type="date" id="filterEnd" style="padding:8px;">
                </div>
                <button id="btnFilter" style="padding:8px 16px; height: 38px;">Apply Filters</button>
            </div>
        </div>

        <!-- Dynamic Metric Cards -->
        <div class="stat-cards" id="metricCardsView"></div>

        <!-- Geospatial Intelligence Map -->
        <div class="card" style="margin-top:24px; padding:0; overflow:hidden;">
            <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-secondary);">
                <h3 style="margin:0;">🗺️ Geospatial Intelligence Map</h3>
            </div>
            <div id="dashboardMap" style="height: 400px; width: 100%; background: #e5e5e5;"></div>
        </div>

        <!-- Table View -->
        <div class="card" style="margin-top:24px;">
            <h3 style="margin-bottom:16px;">🔍 Filtered Entries</h3>
            <div style="overflow-x:auto;">
                <table id="filteredTable" style="width:100%; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--border-subtle);">
                            <th style="padding:12px;">Date</th>
                            <th style="padding:12px;">State/LGA</th>
                            <th style="padding:12px;">Activity Source</th>
                            <th style="padding:12px;">Facility</th>
                            <th style="padding:12px;">Mop Up Qty</th>
                            <th style="padding:12px;">Holds</th>
                            <th style="padding:12px;">Revenue (₦)</th>
                        </tr>
                    </thead>
                    <tbody id="filteredTableBody"></tbody>
                </table>
            </div>
        </div>
    </div>`;

    document.getElementById('btnFilter').onclick = applyFilters;
    
    // Initialize Leaflet Map
    if (typeof L !== 'undefined') {
        dashboardMap = L.map('dashboardMap').setView([9.082, 8.675], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            className: 'map-tiles'
        }).addTo(dashboardMap);
    }
}

function applyFilters() {
    const zoneF = document.getElementById('filterZone')?.value || '';
    const stateF = document.getElementById('filterState')?.value || '';
    const actF = document.getElementById('filterActivity')?.value || '';
    const startF = document.getElementById('filterStart')?.value || '';
    const endF = document.getElementById('filterEnd')?.value || '';

    // Filter reports
    filteredReports = allReports.filter(r => {
        let match = true;
        if (zoneF && r.zone !== zoneF) match = false;
        if (stateF && r.state !== stateF) match = false;
        
        // Map activity types for exact matching if selected
        const mappedActivity = mapActivityKeyToLabel(r.activityKey || r.activityType);
        if (actF && mappedActivity !== actF && r.sourceActivity !== actF) match = false;

        if (startF && (r.inspectionDate || r.meetingDate || r.qmsDate || r.dateOfCase || r.approvalDate) < startF) match = false;
        if (endF && (r.inspectionDate || r.meetingDate || r.qmsDate || r.dateOfCase || r.approvalDate) > endF) match = false;
        return match;
    });

    // Filter sanctions (Consultative Meeting generated)
    filteredSanctions = allSanctions.filter(s => {
        let match = true;
        if (zoneF && s.zone !== zoneF) match = false;
        if (stateF && s.state !== stateF) match = false;
        if (actF && s.sourceActivity !== actF) match = false;
        if (startF && s.inspectionDate < startF) match = false;
        if (endF && s.inspectionDate > endF) match = false;
        return match;
    });

    // Filter manual revenue
    filteredRevenue = allRevenueManual.filter(r => {
        let match = true;
        if (zoneF && r.zone !== zoneF) match = false;
        if (stateF && r.state !== stateF) match = false;
        if (actF && r.sourceActivity !== actF) match = false;
        return match;
    });

    updateDashboardMetrics();
    updateDashboardTable();
    updateDashboardMap();
}

function mapActivityKeyToLabel(key) {
    if (!key) return 'Other';
    if (key === 'routine_surveillance') return 'Routine Surveillance';
    if (key === 'consumer_complaint') return 'Consumer Complaint';
    if (key === 'glsi') return 'GLSI';
    if (key === 'gsdp') return 'GSDP / CEVI';
    if (key === 'lab_report') return 'Lab Report';
    if (key === 'consultative_meeting') return 'Consultative Meeting';
    if (key === 'log-complaints') return 'Consumer Complaint';
    if (key === 'log-adverts') return 'Adverts';
    if (key === 'log-rasff') return 'RASFF';
    return 'Other';
}

function updateDashboardMap() {
    if (!dashboardMap) return;

    // Clear existing markers
    mapMarkers.forEach(m => dashboardMap.removeLayer(m));
    mapMarkers = [];

    // Aggregate data by state
    const stateCounts = {};
    filteredReports.forEach(r => {
        if (!r.state) return;
        stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;
    });

    // Determine max for scaling
    let max = 1;
    Object.values(stateCounts).forEach(v => { if (v > max) max = v; });

    // Plot markers
    for (const [state, count] of Object.entries(stateCounts)) {
        const coords = NIGERIAN_STATES_COORD[state];
        if (coords) {
            // Scale radius based on ratio of max, between 8 and 30
            const radius = 8 + (22 * (count / max));
            
            // Color mapping based on density (hotter = more)
            let color = '#3498db'; // blue
            if (count > max * 0.75) color = '#e74c3c'; // red
            else if (count > max * 0.4) color = '#f39c12'; // orange

            const circle = L.circleMarker(coords, {
                radius: radius,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.7
            }).addTo(dashboardMap);

            circle.bindPopup(`<b>${state} State</b><br>${count} Activities Logged`);
            mapMarkers.push(circle);
        }
    }
}

function updateDashboardMetrics() {
    const totalReports = filteredReports.length;
    
    const uniqueFacilities = new Set(
        filteredReports.map(r => r.facilityName?.trim().toLowerCase()).filter(Boolean)
    );
    const totalFacilities = uniqueFacilities.size;

    const totalSanctions = filteredSanctions.length + filteredRevenue.length;

    let totalMoppedUp = 0;
    let totalHolds = 0;

    filteredReports.forEach(r => {
        const c = r.conditionalData || {};
        const sumCounts = (prefix) => {
            return (Number(c[prefix+'Drugs']) || 0) +
                   (Number(c[prefix+'Food']) || 0) +
                   (Number(c[prefix+'Cosmetics']) || 0) +
                   (Number(c[prefix+'MedDevices']) || 0) +
                   (Number(c[prefix+'Vaccines']) || 0) +
                   (Number(c[prefix+'Chemicals']) || 0) +
                   (Number(c[prefix+'Herbals']) || 0) +
                   (Number(c[prefix+'Water']) || 0);
        };
        totalMoppedUp += sumCounts('mopUp');
        totalHolds += sumCounts('hold');
        
        // Also add legacy mopUpQuantity / holdQuantity if present
        if (r.mopUpQuantity) totalMoppedUp += Number(r.mopUpQuantity) || 0;
        if (r.holdQuantity) totalHolds += Number(r.holdQuantity) || 0;
    });

    const totalRevenueGenerated = 
        filteredSanctions.reduce((s, x) => s + (Number(x.amount)||0), 0) +
        filteredRevenue.reduce((s, x) => s + (Number(x.amount)||0), 0);

    const cardsHtml = `
        <div class="stat-card">
            <div class="stat-card-icon" style="color: #64748b;">📋</div>
            <div class="stat-card-title">Total Reports</div>
            <div class="stat-card-value">${totalReports.toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-card-icon" style="color: #64748b;">🏢</div>
            <div class="stat-card-title">Facilities Visited</div>
            <div class="stat-card-value">${totalFacilities.toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-card-icon" style="color: #64748b;">⚖️</div>
            <div class="stat-card-title">Total Sanctions</div>
            <div class="stat-card-value">${totalSanctions.toLocaleString()}</div>
        </div>
        <div class="stat-card">
            <div class="stat-card-icon" style="color: #64748b;">🧹</div>
            <div class="stat-card-title">Products Mopped Up</div>
            <div class="stat-card-value">${totalMoppedUp.toLocaleString()}</div>
        </div>
        <div class="stat-card" style="border-left: 4px solid var(--primary);">
            <div class="stat-card-icon" style="color: var(--primary);">💰</div>
            <div class="stat-card-title">Total Revenue</div>
            <div class="stat-card-value" style="font-size: 20px;">${formatCurrency(totalRevenueGenerated)}</div>
        </div>
    `;

    document.getElementById('metricCardsView').innerHTML = cardsHtml;
}

function updateDashboardTable() {
    const tbody = document.getElementById('filteredTableBody');
    
    // Convert sanctions/revenue into mock reports to show in the same table if needed, 
    // or just show the reports. We will just show the filtered reports to keep it clean.
    
    if (filteredReports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px;">No records match your filters.</td></tr>';
        return;
    }

    const rows = filteredReports.slice(0, 100).map(r => {
        const dDate = r.inspectionDate || r.meetingDate || r.qmsDate || r.dateOfCase || r.approvalDate || '—';
        const dState = r.state ? `${r.state} / ${r.lga||'—'}` : '—';
        const dAct = r.sourceActivity || mapActivityKeyToLabel(r.activityKey || r.activityType);
        const dFac = r.facilityName || '—';
        
        let mopUpTotal = 0; let holdTotal = 0;
        if (r.conditionalData) {
            const prefixSum = (pfx) => ['Drugs','Food','Cosmetics','MedDevices','Vaccines','Chemicals','Herbals','Water']
                .reduce((sum, k) => sum + (Number(r.conditionalData[pfx+k])||0), 0);
            mopUpTotal = prefixSum('mopUp');
            holdTotal = prefixSum('hold');
        }
        if (r.mopUpQuantity) mopUpTotal += Number(r.mopUpQuantity);
        if (r.holdQuantity) holdTotal += Number(r.holdQuantity);

        // Find associated revenue by facility
        const associatedRevenue = 
            filteredSanctions.filter(s => s.facilityName === r.facilityName).reduce((sum,s) => sum+(Number(s.amount)||0), 0) +
            filteredRevenue.filter(s => s.facilityName === r.facilityName).reduce((sum,s) => sum+(Number(s.amount)||0), 0);

        return `
        <tr style="border-bottom:1px solid var(--border-subtle); font-size:13px;">
            <td style="padding:12px;">${dDate}</td>
            <td style="padding:12px;">${dState}</td>
            <td style="padding:12px;"><span class="badge badge-blue">${dAct}</span></td>
            <td style="padding:12px; font-weight:600;">${dFac}</td>
            <td style="padding:12px;">${mopUpTotal > 0 ? `<span style="color:var(--danger);font-weight:600;">${mopUpTotal}</span>` : '—'}</td>
            <td style="padding:12px;">${holdTotal > 0 ? `<span style="color:#f59e0b;font-weight:600;">${holdTotal}</span>` : '—'}</td>
            <td style="padding:12px; font-weight:700;">${associatedRevenue > 0 ? formatCurrency(associatedRevenue) : '—'}</td>
        </tr>`;
    });

    let extraHtml = '';
    if (filteredReports.length > 100) {
        extraHtml = `<tr><td colspan="7" class="muted" style="text-align:center;padding:12px;">Showing first 100 results...</td></tr>`;
    }

    tbody.innerHTML = rows.join('') + extraHtml;
}
