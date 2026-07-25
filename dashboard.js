/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v4 — NATIONAL INTELLIGENCE DASHBOARD
 * Scalable pagination, XLSX export, and date-range queries.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, getDocs, query, limit, orderBy, where, Timestamp } from "./db.js";
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
let currentTablePage = 0;
const TABLE_PAGE_SIZE = 50;
const QUERY_LIMIT = 2000;

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
        // Fetch data with increased limits for 200+ officer scale
        const rQuery = query(collection(db, 'facilityReports'), orderBy('createdAt', 'desc'), limit(QUERY_LIMIT));
        const rSnap = await getDocs(rQuery);
        allReports = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const sQuery = query(collection(db, 'sanctions'), orderBy('createdAt', 'desc'), limit(QUERY_LIMIT));
        const sSnap = await getDocs(sQuery); 
        allSanctions = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const revQuery = query(collection(db, 'revenue'), limit(QUERY_LIMIT));
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

    const scope = getUserScope();

    let dashboardStateList = ALL_STATES;
    if (scope.zone && !scope.state) {
        dashboardStateList = ZONES[scope.zone] || ALL_STATES;
    }
    const stateOptions = dashboardStateList.map(s => `<option value="${s}">${s}</option>`).join('');
    const zoneOptions = Object.keys(ZONES).map(z => `<option value="${z}">${z}</option>`).join('');

    root.innerHTML = `
    <div class="animate-fade-in">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:12px;">
            <div>
                <h1 style="margin:0;">📊 National Intelligence Dashboard</h1>
                <p class="muted small">Filter actions, facilities, infractions and revenue.</p>
            </div>
            <button class="secondary" id="exportXlsx" style="display:flex; align-items:center; gap:6px;">📥 Export Excel (.xlsx)</button>
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
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
                <h3 style="margin:0;">🔍 Filtered Entries</h3>
                <span id="tableRecordCount" class="muted small"></span>
            </div>
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
            <!-- Pagination Controls -->
            <div id="tablePagination" style="display:flex; justify-content:center; align-items:center; gap:12px; margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle);"></div>
        </div>
    </div>`;

    document.getElementById('btnFilter').onclick = () => { currentTablePage = 0; applyFilters(); };
    document.getElementById('exportXlsx')?.addEventListener('click', exportToExcel);
    
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

    // ── Layer 1: State-level heat bubbles ────────────────────────
    const stateCounts = {};
    filteredReports.forEach(r => {
        if (!r.state) return;
        stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;
    });

    let max = 1;
    Object.values(stateCounts).forEach(v => { if (v > max) max = v; });

    for (const [state, count] of Object.entries(stateCounts)) {
        const coords = NIGERIAN_STATES_COORD[state];
        if (coords) {
            const radius = 8 + (22 * (count / max));
            let color = '#3498db';
            if (count > max * 0.75) color = '#e74c3c';
            else if (count > max * 0.4) color = '#f39c12';

            const circle = L.circleMarker(coords, {
                radius: radius,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.5
            }).addTo(dashboardMap);

            circle.bindPopup(`<b>${state} State</b><br>${count} Activities Logged`);
            mapMarkers.push(circle);
        }
    }

    // ── Layer 2: Individual GPS pins (from live captures) ────────
    const gpsReports = filteredReports.filter(r => r.geoLat && r.geoLng);
    gpsReports.forEach(r => {
        const pin = L.circleMarker([r.geoLat, r.geoLng], {
            radius: 5,
            fillColor: '#008751',
            color: '#fff',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(dashboardMap);

        const date = r.inspectionDate || '—';
        const officer = r.createdByName || r.createdByEmail || '—';
        const facility = r.facilityName || '—';
        const accuracy = r.geoAccuracy ? `±${Math.round(r.geoAccuracy)}m` : '';

        pin.bindPopup(`
            <div style="font-size:12px; line-height:1.6;">
                <b>📍 ${facility}</b><br>
                <span style="color:#64748b;">Officer:</span> ${officer}<br>
                <span style="color:#64748b;">Date:</span> ${date}<br>
                <span style="color:#64748b;">GPS:</span> ${r.geoLat.toFixed(5)}, ${r.geoLng.toFixed(5)} ${accuracy}
            </div>
        `);
        mapMarkers.push(pin);
    });
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

function getReportRowData(r) {
    const dDate = r.inspectionDate || r.meetingDate || r.qmsDate || r.dateOfCase || r.approvalDate || '—';
    const dState = r.state || '—';
    const dLga = r.lga || '—';
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

    const associatedRevenue = 
        filteredSanctions.filter(s => s.facilityName === r.facilityName).reduce((sum,s) => sum+(Number(s.amount)||0), 0) +
        filteredRevenue.filter(s => s.facilityName === r.facilityName).reduce((sum,s) => sum+(Number(s.amount)||0), 0);

    return { dDate, dState, dLga, dAct, dFac, mopUpTotal, holdTotal, associatedRevenue };
}

function updateDashboardTable() {
    const tbody = document.getElementById('filteredTableBody');
    const countEl = document.getElementById('tableRecordCount');
    const paginationEl = document.getElementById('tablePagination');
    const total = filteredReports.length;
    
    if (countEl) countEl.textContent = `${total.toLocaleString()} records found`;
    
    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px;">No records match your filters.</td></tr>';
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(total / TABLE_PAGE_SIZE);
    if (currentTablePage >= totalPages) currentTablePage = totalPages - 1;
    const startIdx = currentTablePage * TABLE_PAGE_SIZE;
    const pageData = filteredReports.slice(startIdx, startIdx + TABLE_PAGE_SIZE);

    const rows = pageData.map(r => {
        const d = getReportRowData(r);
        return `
        <tr style="border-bottom:1px solid var(--border-subtle); font-size:13px;">
            <td style="padding:12px;">${d.dDate}</td>
            <td style="padding:12px;">${d.dState} / ${d.dLga}</td>
            <td style="padding:12px;"><span class="badge badge-blue">${d.dAct}</span></td>
            <td style="padding:12px; font-weight:600;">${d.dFac}</td>
            <td style="padding:12px;">${d.mopUpTotal > 0 ? `<span style="color:var(--danger);font-weight:600;">${d.mopUpTotal}</span>` : '—'}</td>
            <td style="padding:12px;">${d.holdTotal > 0 ? `<span style="color:#f59e0b;font-weight:600;">${d.holdTotal}</span>` : '—'}</td>
            <td style="padding:12px; font-weight:700;">${d.associatedRevenue > 0 ? formatCurrency(d.associatedRevenue) : '—'}</td>
        </tr>`;
    });

    tbody.innerHTML = rows.join('');

    // Render pagination controls
    if (paginationEl && totalPages > 1) {
        paginationEl.innerHTML = `
            <button id="pgPrev" class="secondary" style="padding:6px 14px; font-size:13px;" ${currentTablePage === 0 ? 'disabled' : ''}>← Prev</button>
            <span class="muted small">Page ${currentTablePage + 1} of ${totalPages}</span>
            <button id="pgNext" class="secondary" style="padding:6px 14px; font-size:13px;" ${currentTablePage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        `;
        document.getElementById('pgPrev')?.addEventListener('click', () => { currentTablePage--; updateDashboardTable(); });
        document.getElementById('pgNext')?.addEventListener('click', () => { currentTablePage++; updateDashboardTable(); });
    } else if (paginationEl) {
        paginationEl.innerHTML = '';
    }
}

// ── XLSX EXPORT (SheetJS) ───────────────────────────────────────
async function exportToExcel() {
    showToast('Preparing Export', 'Building Excel file...', 'info', 3000);
    try {
        // Dynamically load SheetJS
        if (!window.XLSX) {
            const script = document.createElement('script');
            script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
            document.head.appendChild(script);
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = () => reject(new Error('Failed to load SheetJS'));
            });
        }

        // Build rows from ALL filtered data (not just current page)
        const exportData = filteredReports.map(r => {
            const d = getReportRowData(r);
            return {
                'Date': d.dDate,
                'State': d.dState,
                'LGA': d.dLga,
                'Activity': d.dAct,
                'Facility': d.dFac,
                'Mop Up Qty': d.mopUpTotal,
                'Hold Qty': d.holdTotal,
                'Revenue (₦)': d.associatedRevenue,
                'Officer': r.submittedBy || r.officerName || '—',
                'Zone': r.zone || '—'
            };
        });

        const ws = window.XLSX.utils.json_to_sheet(exportData);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'PMS Intelligence Data');

        // Auto-width columns
        const colWidths = Object.keys(exportData[0] || {}).map(key => ({
            wch: Math.max(key.length, ...exportData.map(row => String(row[key] || '').length).slice(0, 100)) + 2
        }));
        ws['!cols'] = colWidths;

        const dateStr = new Date().toISOString().split('T')[0];
        window.XLSX.writeFile(wb, `NAFDAC_PMS_Report_${dateStr}.xlsx`);
        showToast('Export Complete', `${exportData.length} records exported to Excel.`, 'success');
    } catch (err) {
        console.error('Export error:', err);
        showToast('Export Failed', err.message, 'error');
    }
}
