/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v2 — FACILITY MANAGEMENT MODULE
 * Facility directory, search, profiles with activity history.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, getDocs, query, where, orderBy, doc, getDoc, limit } from "./db.js";
import { clearRoot, showToast, showLoading, showModal } from "./ui.js";
import { formatCurrency, getZoneForState } from "./constants.js";
import { getUserScope } from "./auth.js";

export async function loadFacilitiesPage(root, user, userData) {
    showLoading(root, 'Loading facilities...');

    try {
        // --- NATIONAL SCOPE ENFORCEMENT ---
        // We no longer filter by user.state or user.zone here.
        // Every officer sees the national directory for intelligence continuity.
        const q = query(collection(db, 'facilities'), orderBy('lastVisitDate', 'desc'), limit(500));

        const snap = await getDocs(q);
        const facilities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        facilities.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        renderFacilitiesList(root, facilities, userData);
    } catch (err) {
        console.error("Error loading facilities:", err);
        root.innerHTML = `<div class="card"><p class="muted">Error loading facilities: ${err.message}</p></div>`;
    }
}

function renderFacilitiesList(root, facilities, userData) {
    let activeLetterFilter = 'ALL';
    
    // Header & A-Z Letters
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width:1200px; margin:0 auto; padding-bottom:60px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 24px;">
            <h1 style="margin:0; font-size:28px;">A-Z Directory</h1>
        </div>

        <div id="azFilterBar" style="display:flex; flex-wrap:wrap; justify-content:center; gap:6px; margin-bottom:32px; background:white; padding:16px; border-radius:8px; border:1px solid var(--border-subtle);">
            ${['ALL', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'].map(lt => `
                <button class="letter-btn ${lt==='ALL'?'active':''}" data-val="${lt}" style="padding:6px 12px; min-width:36px; border:none; background:${lt==='ALL'?'var(--primary)':'transparent'}; color:${lt==='ALL'?'white':'var(--text-secondary)'}; font-weight:700; border-radius:6px; cursor:pointer;">${lt}</button>
            `).join('')}
        </div>

        <!-- Search / Filter -->
        <div style="display:flex; gap:16px; align-items:flex-end; flex-wrap:wrap; margin-bottom: 32px; background:white; padding:16px; border-radius:8px; border:1px solid var(--border-subtle);">
            <div class="form-group" style="flex:1; margin:0; min-width:260px;">
                <label style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--text-secondary); margin-bottom:8px;">Search Platform</label>
                <div style="position:relative;">
                    <span style="position:absolute; left:12px; top:10px; opacity:0.5;">🔍</span>
                    <input type="text" id="facilitySearch" placeholder="Type name or address..." style="padding-left:36px; margin:0;">
                </div>
            </div>
            <div class="form-group" style="margin:0; min-width:160px;">
                <label style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--text-secondary); margin-bottom:8px;">Status</label>
                <select id="facilityFilter" style="margin:0;">
                    <option value="all">All Statuses</option>
                    <option value="sanctions">With Sanctions</option>
                    <option value="defaulters">Owing Payments</option>
                </select>
            </div>
        </div>

        <!-- Facility List Grid -->
        <div id="facilityTableBody" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:24px;">
            <!-- Rendered by applyFilters -->
        </div>
    </div>`;

    const searchInput = document.getElementById('facilitySearch');
    const filterSelect = document.getElementById('facilityFilter');
    const tbody = document.getElementById('facilityTableBody');
    const azBtns = document.querySelectorAll('.letter-btn');

    const applyFilters = () => {
        const term = searchInput.value.toLowerCase();
        const filter = filterSelect.value;
        let filtered = facilities;

        // Apply Letter
        if (activeLetterFilter !== 'ALL') {
            if (activeLetterFilter === '#') {
                filtered = filtered.filter(f => /^[0-9]/.test(f.name?.[0] || ''));
            } else {
                filtered = filtered.filter(f => (f.name?.[0] || '').toUpperCase() === activeLetterFilter);
            }
        }

        // Apply Term
        if (term) {
            filtered = filtered.filter(f =>
                (f.name || '').toLowerCase().includes(term) ||
                (f.address || '').toLowerCase().includes(term)
            );
        }

        // Apply Dropdown Filter
        if (filter === 'sanctions') filtered = filtered.filter(f => (f.sanctions || 0) > 0);
        if (filter === 'defaulters') filtered = filtered.filter(f => (f.totalOwed || 0) > 0);

        tbody.innerHTML = filtered.length === 0 ?
            `<div class="card" style="text-align:center;padding:60px;grid-column:1/-1; background:white; border-radius:8px;"><div style="font-size:40px; margin-bottom:16px;">📂</div><h3 style="margin:0 0 8px 0;">No Facilities Found</h3><p class="muted">Try adjusting your filters or search terms.</p></div>` :
            filtered.map(f => {
                const actUpper = (f.lastActivity || '').toUpperCase();
                const showPill = actUpper.includes('GLSI') || actUpper.includes('GSDP');
                const badgeText = (f.totalOwed || 0) > 0 ? 'PENDING' : 'ACTIVE';
                const badgeStyle = badgeText === 'ACTIVE' ? 'background:#e8f5e9; color:#2e7d32;' : 'background:#ffebee; color:#c62828;';

                return `
                <div class="facility-row animate-fade-in" data-id="${f.id}" style="cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; border-radius:8px; border:1px solid var(--border-subtle); background:white; position:relative; overflow:hidden; transition:transform 0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
                    <div style="padding:20px;">
                        <h3 style="margin:0 0 8px 0; font-size:16px; font-weight:700; color:var(--text-primary); text-transform:uppercase;">${f.name || '—'}</h3>
                        <span style="font-size:10px; padding:3px 8px; font-weight:800; border-radius:4px; margin-bottom:16px; display:inline-block; ${badgeStyle}">
                            ${badgeText}
                        </span>
                        <div style="font-size:13px; color:var(--text-secondary); margin-bottom:8px; display:flex; align-items:flex-start; gap:8px;">
                            <span style="color:#d32f2f;">📍</span> <span style="line-height:1.4;">${f.address || '—'}, ${f.state || '—'}</span>
                        </div>
                        <div style="font-size:13px; color:var(--text-secondary); margin-bottom:16px; display:flex; align-items:center; gap:8px;">
                            <span style="opacity:0.5;">⏱</span> <span>Last Visit: ${f.lastVisitDate || '—'}</span>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; min-height:22px;">
                            ${showPill ? `<span style="background:#f1f8e9; color:#33691e; border:1px solid #dcedc8; font-size:10px; padding:4px 8px; border-radius:4px; font-weight:700;">${f.lastActivity.toUpperCase()}</span>` : ''}
                        </div>
                    </div>
                    <div style="border-top:1px solid var(--border-subtle); padding:16px 20px; display:flex; justify-content:space-between; align-items:center; background:#fafafa;">
                        <span style="font-size:13px; color:var(--text-secondary);">Total Visits: <strong>${f.totalVisits || 0}</strong></span>
                        <span style="font-size:13px; font-weight:700; color:var(--primary);">View Profile →</span>
                    </div>
                </div>
            `}).join('');

        bindRowClicks(filtered);
    };

    searchInput.oninput = applyFilters;
    filterSelect.onchange = applyFilters;
    azBtns.forEach(btn => {
        btn.onclick = () => {
            activeLetterFilter = btn.dataset.val;
            azBtns.forEach(b => {
                b.style.background = b.dataset.val === activeLetterFilter ? 'var(--primary)' : 'transparent';
                b.style.color = b.dataset.val === activeLetterFilter ? 'white' : 'var(--text-secondary)';
            });
            applyFilters();
        };
    });

    // Row click → facility profile
    const bindRowClicks = (list) => {
        root.querySelectorAll('.facility-row').forEach(row => {
            row.onclick = async () => {
                const fac = list.find(f => f.id === row.dataset.id);
                if (fac) await showFacilityProfile(fac);
            };
        });
    };
    
    // Mount initial DOM state
    applyFilters();
}

export async function showFacilityProfile(facility) {
    const root = document.getElementById('app');
    const facilitiesListSnapshot = root.innerHTML; // Cache directory state
    
    // Show quick loader
    root.innerHTML = '<div style="text-align:center;padding:100px;"><div class="spinner spinner-lg"></div></div>';

    // 1. Get Daily Activities
    let activities = [];
    try {
        const q = query(collection(db, 'facilityReports'), where('facilityName', '==', facility.name));
        const snap = await getDocs(q);
        activities = snap.docs.map(d => d.data());
    } catch (e) {}

    // 2. Get Sanctions
    let sanctions = [];
    try {
        const q = query(collection(db, 'sanctions'), where('facilityName', '==', facility.name));
        const snap = await getDocs(q);
        sanctions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {}

    // 3. Get Complaints
    let complaints = [];
    try {
        const q = query(collection(db, 'complaints'), where('facilityName', '==', facility.name));
        const snap = await getDocs(q);
        complaints = snap.docs.map(d => d.data());
    } catch (e) {}

    // 4. Get Revenue
    let revenues = [];
    try {
        const q = query(collection(db, 'revenue'), where('facilityName', '==', facility.name));
        const snap = await getDocs(q);
        revenues = snap.docs.map(d => d.data());
    } catch (e) {}

    // Sort timelines
    activities.sort((a, b) => (b.inspectionDate || '').localeCompare(a.inspectionDate || ''));
    sanctions.sort((a, b) => (b.date || b.createdAt?.toMillis()?.toString() || '').localeCompare(a.date || a.createdAt?.toMillis()?.toString() || ''));
    complaints.sort((a, b) => (b.dateLogged || '').localeCompare(a.dateLogged || ''));
    revenues.sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));

    const formatSancRevRows = (arr, isRev) => arr.length === 0 ? `<tr><td colspan="4" class="muted" style="text-align:center;padding:32px;">No financial records found.</td></tr>` : 
        arr.map(r => `
        <tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:16px;">${(isRev?r.dateLogged:r.date) || '—'}</td>
            <td style="padding:16px;">${r.activitySource || r.activityType || r.offence || '—'}</td>
            <td style="padding:16px; font-weight:700;">${formatCurrency(isRev?r.amount:(r.amount||0))}</td>
            <td style="padding:16px;"><span class="badge ${r.paymentStatus==='Paid'||r.status==='Paid' ? 'badge-green' : 'badge-red'}">${r.paymentStatus||r.status||'Outstanding'}</span></td>
        </tr>
    `).join('');

    const renderTable = (headers, rowsHTML) => `
        <div style="background:white; border-radius:8px; border:1px solid var(--border-subtle); overflow:hidden;">
            <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead><tr style="background:#fafafa; border-bottom:1px solid var(--border-subtle);">
                    ${headers.map(h => `<th style="padding:16px; font-size:12px; color:var(--text-secondary);">${h}</th>`).join('')}
                </tr></thead>
                <tbody>${rowsHTML}</tbody>
            </table>
        </div>
    `;

    const histRows = activities.length === 0 ? `<tr><td colspan="4" class="muted" style="text-align:center;padding:32px;">No recorded inspections yet.</td></tr>` : 
        activities.map(a => `
        <tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:16px;">${a.inspectionDate || '—'}</td>
            <td style="padding:16px;"><span style="background:#e3f2fd; color:#1565c0; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:700;">${a.activityType || '—'}</span></td>
            <td style="padding:16px;">${a.state || '—'}</td>
            <td style="padding:16px;">${a.createdByName || '—'}</td>
        </tr>
    `).join('');
    
    const compRows = complaints.length === 0 ? `<tr><td colspan="3" class="muted" style="text-align:center;padding:32px;">No consumer complaints on file.</td></tr>` : 
        complaints.map(c => `
        <tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:16px;">${c.dateLogged || '—'}</td>
            <td style="padding:16px;">${c.productName || '—'}</td>
            <td style="padding:16px;">${c.status || '—'}</td>
        </tr>
    `).join('');

    const tabHTML = {
        'history': renderTable(['DATE', 'ACTIVITY TYPE', 'STATE LOCATION', 'LEAD OFFICER'], histRows),
        'sanctions': renderTable(['ISSUE DATE', 'ORIGIN ACTIVITY / OFFENCE', 'AMOUNT', 'STATUS'], formatSancRevRows([...sanctions, ...revenues].sort((a,b)=>((b.date||b.dateLogged||'').localeCompare(a.date||a.dateLogged||''))), false)),
        'complaints': renderTable(['DATE REPORTED', 'PRODUCT IMPLICATED', 'STATUS'], compRows),
        'other': `<div style="text-align:center; padding:60px; background:white; border-radius:8px; border:1px solid var(--border-subtle);"><span style="font-size:40px;">🚧</span><h3 style="margin-top:16px;">Module In Development</h3><p class="muted">This specific tab acts as a placeholder for Phase 14.</p></div>`
    };

    const outsdBg = facility.totalOwed > 0 ? '#ffebee' : '#f5f5f5';
    const outsdTxt = facility.totalOwed > 0 ? '#c62828' : 'var(--text-secondary)';

    // Risk Categorization extraction
    const gsdpActivities = activities.filter(a => a.activityType && a.activityType.includes('GSDP'));
    const latestRisk = gsdpActivities.length > 0 ? (gsdpActivities[0].riskCategory || 'Unknown Risk') : null;
    let riskCardHTML = '';
    
    if (latestRisk) {
        let riskColor = '#2196f3', riskBg = '#e3f2fd', riskIcon = '⚠️';
        if (latestRisk.toLowerCase().includes('high')) { riskColor = '#c62828'; riskBg = '#ffebee'; riskIcon = '🚨'; }
        else if (latestRisk.toLowerCase().includes('medium')) { riskColor = '#e65100'; riskBg = '#fff3e0'; riskIcon = '⚡'; }
        else if (latestRisk.toLowerCase().includes('low')) { riskColor = '#2e7d32'; riskBg = '#e8f5e9'; riskIcon = '✅'; }

        riskCardHTML = `
        <div style="background:white; padding:24px; border-radius:12px; border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:flex-start;">
            <span style="font-size:24px; padding:12px; background:${riskBg}; border-radius:8px;">${riskIcon}</span>
            <div style="text-align:right;">
                <div style="color:var(--text-secondary); font-size:11px; font-weight:800; letter-spacing:0.5px; margin-bottom:8px;">RISK RATING</div>
                <div style="font-size:18px; font-weight:800; color:${riskColor};">${latestRisk.toUpperCase()}</div>
            </div>
        </div>`;
    }

    root.innerHTML = `
    <div class="animate-fade-in" style="max-width:1200px; margin:0 auto; padding-bottom:80px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
            <button class="secondary" id="profBackBtn" style="border:none; padding:8px 16px; font-size:16px; background:transparent; font-weight:700; cursor:pointer;">&larr; BACK TO DIRECTORY</button>
        </div>

        <div style="background:white; border:1px solid var(--border-subtle); border-radius:12px; padding:32px; margin-bottom:24px; display:flex; justify-content:space-between; align-items:flex-start; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
            <div>
                <h1 style="color:var(--text-primary); margin:0 0 12px 0; font-size:28px; text-transform:uppercase;">${facility.name}</h1>
                <div style="display:flex; align-items:center; gap:8px; color:var(--text-secondary); margin-bottom:16px; font-size:15px;">
                    <span style="opacity:0.5;">📍</span> ${facility.address || '—'}
                </div>
                <div style="display:flex; align-items:center; gap:16px; color:var(--text-secondary); font-size:13px; font-weight:500;">
                    <div><span style="opacity:0.5; margin-right:4px;">⏱</span> LAST VISITED: ${facility.lastVisitDate ? facility.lastVisitDate.split('-')[0] : '—'}</div>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:16px;">
                <span style="padding:6px 16px; font-size:12px; font-weight:800; letter-spacing:1px; border-radius:4px; ${facility.totalOwed > 0 ? 'background:#ffebee; color:#c62828;' : 'background:#e8f5e9; color:#2e7d32;'}">
                    ${facility.totalOwed > 0 ? 'PENDING' : 'ACTIVE'}
                </span>
                <button class="secondary" style="font-weight:600; display:flex; align-items:center; gap:8px; padding:8px 16px;">
                    <span>✏️</span> EDIT PROFILE
                </button>
            </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:32px;">
            ${riskCardHTML}
            <div style="background:white; padding:24px; border-radius:12px; border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:flex-start;">
                <span style="font-size:24px; padding:12px; background:#f0f9ff; border-radius:8px;">📋</span>
                <div style="text-align:right;">
                    <div style="color:var(--text-secondary); font-size:11px; font-weight:800; letter-spacing:0.5px; margin-bottom:8px;">TOTAL INSPECTIONS</div>
                    <div style="font-size:28px; font-weight:700;">${facility.totalVisits || 0}</div>
                </div>
            </div>
            <div style="background:white; padding:24px; border-radius:12px; border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:flex-start;">
                <span style="font-size:24px; padding:12px; background:#fff8e1; border-radius:8px;">💲</span>
                <div style="text-align:right;">
                    <div style="color:var(--text-secondary); font-size:11px; font-weight:800; letter-spacing:0.5px; margin-bottom:8px;">FINES ISSUED</div>
                    <div style="font-size:22px; font-weight:700;">${formatCurrency((facility.totalPaid || 0) + (facility.totalOwed || 0))}</div>
                </div>
            </div>
            <div style="background:white; padding:24px; border-radius:12px; border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:flex-start;">
                <span style="font-size:24px; padding:12px; background:${outsdBg}; border-radius:8px;">❌</span>
                <div style="text-align:right;">
                    <div style="color:var(--text-secondary); font-size:11px; font-weight:800; letter-spacing:0.5px; margin-bottom:8px;">OUTSTANDING</div>
                    <div style="font-size:22px; font-weight:700; color:${outsdTxt};">${formatCurrency(facility.totalOwed || 0)}</div>
                </div>
            </div>
            <div style="background:white; padding:24px; border-radius:12px; border:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:flex-start;">
                <span style="font-size:24px; padding:12px; background:#f5f5f5; border-radius:8px;">📅</span>
                <div style="text-align:right;">
                    <div style="color:var(--text-secondary); font-size:11px; font-weight:800; letter-spacing:0.5px; margin-bottom:8px;">LAST VISIT</div>
                    <div style="font-size:16px; font-weight:700; margin-top:8px;">${facility.lastVisitDate || '—'}</div>
                </div>
            </div>
        </div>

        <div style="display:flex; gap:32px; border-bottom:1px solid var(--border-subtle); margin-bottom:24px; overflow-x:auto;">
            <button class="prof-tab active" data-tab="history" style="background:transparent; border:none; padding:12px 0; font-size:14px; font-weight:700; color:var(--primary); border-bottom:3px solid var(--primary); cursor:pointer;">Inspection History</button>
            <button class="prof-tab" data-tab="sanctions" style="background:transparent; border:none; padding:12px 0; font-size:14px; font-weight:600; color:var(--text-secondary); border-bottom:3px solid transparent; cursor:pointer;">Sanctions & Fines</button>
            <button class="prof-tab" data-tab="complaints" style="background:transparent; border:none; padding:12px 0; font-size:14px; font-weight:600; color:var(--text-secondary); border-bottom:3px solid transparent; cursor:pointer;">Consumer Complaints</button>
            <button class="prof-tab" data-tab="other" style="background:transparent; border:none; padding:12px 0; font-size:14px; font-weight:600; color:var(--text-secondary); border-bottom:3px solid transparent; cursor:pointer;">Documents</button>
            <button class="prof-tab" data-tab="other" style="background:transparent; border:none; padding:12px 0; font-size:14px; font-weight:600; color:var(--text-secondary); border-bottom:3px solid transparent; cursor:pointer;">File Registry</button>
            <button class="prof-tab" data-tab="other" style="background:transparent; border:none; padding:12px 0; font-size:14px; font-weight:600; color:var(--text-secondary); border-bottom:3px solid transparent; cursor:pointer;">Branches</button>
        </div>

        <div id="profTabContent">
            ${tabHTML['history']}
        </div>
    </div>`;

    document.getElementById('profBackBtn').onclick = () => {
        root.innerHTML = facilitiesListSnapshot;
        // Re-bind listeners just in case
        const searchInput = document.getElementById('facilitySearch');
        if (searchInput) searchInput.oninput = () => document.getElementById('facilityFilter').onchange();
        // Just reload standard
        loadFacilitiesPage(root, null, null); 
    };

    const tabs = document.querySelectorAll('.prof-tab');
    const contentArea = document.getElementById('profTabContent');
    
    tabs.forEach(btn => {
        btn.onclick = () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.style.color = 'var(--text-secondary)';
                t.style.fontWeight = '600';
                t.style.borderBottom = '3px solid transparent';
            });
            btn.classList.add('active');
            btn.style.color = 'var(--primary)';
            btn.style.fontWeight = '700';
            btn.style.borderBottom = '3px solid var(--primary)';
            
            contentArea.innerHTML = tabHTML[btn.dataset.tab] || '';
        };
    });
}
