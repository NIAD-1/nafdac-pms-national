/**
 * Surveillance Watchlist
 * One lightweight workflow for product alerts, recalls, advert watches, and RASFF notices.
 */
import { db, collection, addDoc, getDocs, query, where, serverTimestamp, doc, updateDoc } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, buildFormFields, initFormChoices, escapeHtml } from "./ui.js";
import { ALL_STATES, ROLES } from "./constants.js";
import { triggerServerPush } from "./server-push.js";

const WATCHLIST_TYPES = {
    product_alert: { label: 'Product Alert', icon: '🚨', badge: 'badge-red' },
    recall: { label: 'Recall', icon: '↩️', badge: 'badge-yellow' },
    advert_watch: { label: 'Advert Watch', icon: '📺', badge: 'badge-blue' },
    rasff: { label: 'RASFF Notice', icon: '🌐', badge: 'badge-purple' }
};

const PRIORITY_BADGE = {
    Critical: 'badge-red',
    High: 'badge-yellow',
    Medium: 'badge-blue',
    Low: 'badge-green'
};

export async function loadAlertsPage(root, currentUser, currentUserData) {
    clearRoot(root);
    const canCreate = (ROLES[currentUserData?.role]?.level || 1) >= 2;

    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 1120px; margin: 0 auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:20px;">
            <div>
                <h1 style="margin-bottom:4px;">🎯 Surveillance Watchlist</h1>
                <p class="muted small">Alerts, recalls, advert watches, and RASFF notices officers should verify during surveillance.</p>
            </div>
            ${canCreate ? `<button id="btnNewAlert">+ New Watchlist Item</button>` : ''}
        </div>
        <div id="alertsContent"></div>
    </div>`;

    const content = document.getElementById('alertsContent');
    document.getElementById('btnNewAlert')?.addEventListener('click', () => renderWatchlistForm(content, currentUser, currentUserData));
    await loadWatchlistDashboard(content, currentUserData);
}

function appliesToScope(item, scope) {
    if (item.status === 'closed') return !scope.state && !scope.zone;
    if (!item.approvalStatus || item.approvalStatus === 'approved') {
        if (!scope.state && !scope.zone) return true;
        if (item.scope === 'nationwide') return true;
        if (scope.state && item.state === scope.state) return true;
        if (scope.zone && item.zone === scope.zone) return true;
        if (scope.state && Array.isArray(item.targetStates) && item.targetStates.includes(scope.state)) return true;
        return false;
    }
    return !scope.state && !scope.zone;
}

async function loadWatchlistDashboard(container, currentUserData) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div></div>';
    const scope = getUserScope();

    try {
        const [watchSnap, reportSnap, responseSnap] = await Promise.all([
            getDocs(query(collection(db, 'alerts'))),
            scope.state
                ? getDocs(query(collection(db, 'facilityReports'), where('state', '==', scope.state)))
                : scope.zone
                    ? getDocs(query(collection(db, 'facilityReports'), where('zone', '==', scope.zone)))
                    : getDocs(query(collection(db, 'facilityReports'))),
            scope.state
                ? getDocs(query(collection(db, 'watchlistResponses'), where('state', '==', scope.state)))
                : scope.zone
                    ? getDocs(query(collection(db, 'watchlistResponses'), where('zone', '==', scope.zone)))
                    : getDocs(query(collection(db, 'watchlistResponses')))
        ]);

        const watchItems = watchSnap.docs
            .map(d => ({ id: d.id, itemType: 'product_alert', scope: 'nationwide', approvalStatus: 'approved', ...d.data() }))
            .filter(item => appliesToScope(item, scope));
        const reports = reportSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const responseRecords = responseSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const responses = reports.filter(r =>
            r.activityKey === 'routine_surveillance' &&
            r.conditionalData?.alertSurveillanceConducted === 'yes' &&
            (r.alertProduct || r.alertProductOutcome)
        );

        if (watchItems.length === 0) {
            container.innerHTML = `
            <div class="card" style="text-align:center; padding:48px;">
                <div style="font-size:48px; margin-bottom:12px;">🎯</div>
                <h3>No Active Watchlist Items</h3>
                <p class="muted small">When alerts, recalls, advert watches, or RASFF notices are active, they will appear here.</p>
            </div>`;
            return;
        }

        const enriched = watchItems.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(item => {
            const itemName = item.productName || item.title || item.companyName || item.alertRef || '';
            const itemResponses = responseRecords.filter(r => r.watchlistItemId === item.id);
            const legacyResponses = responses.filter(r => r.alertProduct === itemName);
            const allResponses = itemResponses.length ? itemResponses : legacyResponses;
            const found = allResponses.filter(r => (r.outcome || r.alertProductOutcome) === 'Alert Product Found / Received');
            return {
                ...item,
                displayName: itemName || 'Untitled Watchlist Item',
                responseCount: allResponses.length,
                foundCount: found.length,
                statesFound: [...new Set(found.map(r => r.state).filter(Boolean))],
                responses: allResponses
            };
        });

        container.innerHTML = `
        <div class="watchlist-summary">
            <div><strong>${enriched.length}</strong><span>Active Items</span></div>
            <div><strong>${responses.length}</strong><span>Checks Recorded</span></div>
            <div><strong>${enriched.reduce((sum, i) => sum + i.foundCount, 0)}</strong><span>Confirmed Findings</span></div>
        </div>
        <div class="watchlist-grid">
            ${enriched.map(item => renderWatchlistCard(item, currentUserData)).join('')}
        </div>`;

        container.querySelectorAll('[data-watchlist-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = enriched.find(x => x.id === btn.dataset.watchlistView);
                if (item) renderWatchlistDetail(container, item, currentUserData);
            });
        });

        container.querySelectorAll('[data-watchlist-approve]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const watchlistId = btn.dataset.watchlistApprove;
                await updateDoc(doc(db, 'alerts', btn.dataset.watchlistApprove), {
                    approvalStatus: 'approved',
                    approvedBy: currentUserData?.displayName || currentUserData?.email || 'HQ',
                    approvedAt: serverTimestamp()
                });
                try {
                    await triggerServerPush('watchlist', watchlistId);
                    showToast('Approved', 'Nationwide watchlist item is approved and phone push was requested.', 'success');
                } catch (err) {
                    showToast('Approved', `Approved, but phone push was not sent: ${err.message}`, 'warning', 7000);
                }
                loadWatchlistDashboard(container, currentUserData);
            });
        });

        container.querySelectorAll('[data-watchlist-close]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await updateDoc(doc(db, 'alerts', btn.dataset.watchlistClose), {
                    status: 'closed',
                    closedBy: currentUserData?.displayName || currentUserData?.email || 'Officer',
                    closedAt: serverTimestamp()
                });
                showToast('Closed', 'Watchlist item has been closed.', 'success');
                loadWatchlistDashboard(container, currentUserData);
            });
        });

    } catch (err) {
        console.error("Watchlist error:", err);
        container.innerHTML = `<div class="card"><p class="muted">Error: ${escapeHtml(err.message)}</p></div>`;
    }
}

function renderWatchlistCard(item, currentUserData) {
    const type = WATCHLIST_TYPES[item.itemType] || WATCHLIST_TYPES.product_alert;
    const priority = item.priority || 'Medium';
    const coverage = formatCoverage(item);
    const image = item.productImageUrl || item.evidenceUrl || '';
    const canManage = (ROLES[currentUserData?.role]?.level || 1) >= 3;
    const isNational = ['admin', 'national_admin'].includes(currentUserData?.role);
    const isPending = item.approvalStatus === 'pending_national_approval';
    return `
    <article class="watchlist-card">
        ${image ? `<img class="watchlist-image" src="${escapeHtml(image)}" alt="${escapeHtml(item.displayName)}">` : `<div class="watchlist-image placeholder">${type.icon}</div>`}
        <div class="watchlist-card-body">
            <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
                <span class="badge ${type.badge}">${type.icon} ${type.label}</span>
                <span class="badge ${PRIORITY_BADGE[priority] || 'badge-blue'}">${escapeHtml(priority)}</span>
            </div>
            ${isPending ? `<div style="margin-top:10px;"><span class="badge badge-yellow">Pending HQ Approval</span></div>` : ''}
            ${item.status === 'closed' ? `<div style="margin-top:10px;"><span class="badge badge-gray">Closed</span></div>` : ''}
            <h3>${escapeHtml(item.displayName)}</h3>
            <p>${escapeHtml(item.reason || item.risk || item.instructions || 'Review field instructions during surveillance.')}</p>
            <div class="watchlist-meta">
                <span>${escapeHtml(item.alertRef || item.referenceNo || 'No reference')}</span>
                <span>${escapeHtml(coverage)}</span>
            </div>
            <div class="watchlist-response-row">
                <div><strong>${item.responseCount}</strong><span>Checks</span></div>
                <div><strong>${item.foundCount}</strong><span>Found</span></div>
                <div><strong>${item.statesFound.length || 0}</strong><span>States</span></div>
            </div>
            ${item.instructions ? `<div class="watchlist-instructions">${escapeHtml(item.instructions)}</div>` : ''}
            <div class="watchlist-actions">
                <button class="secondary" data-watchlist-view="${escapeHtml(item.id)}">View Details</button>
                ${isPending && isNational ? `<button class="success" data-watchlist-approve="${escapeHtml(item.id)}">Approve</button>` : ''}
                ${canManage && item.status !== 'closed' ? `<button class="secondary" data-watchlist-close="${escapeHtml(item.id)}">Close</button>` : ''}
            </div>
        </div>
    </article>`;
}

function renderWatchlistDetail(container, item, currentUserData) {
    const type = WATCHLIST_TYPES[item.itemType] || WATCHLIST_TYPES.product_alert;
    const rows = (item.responses || []).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(r => `
        <tr>
            <td>${escapeHtml(r.inspectionDate || '—')}</td>
            <td>${escapeHtml(r.state || '—')}</td>
            <td>${escapeHtml(r.facilityName || '—')}</td>
            <td><span class="badge ${(r.outcome || r.alertProductOutcome) === 'Alert Product Found / Received' ? 'badge-red' : 'badge-green'}">${escapeHtml(r.outcome || r.alertProductOutcome || 'Checked')}</span></td>
            <td>${escapeHtml(r.details || r.alertProductDetails || '—')}</td>
        </tr>
    `).join('');

    container.innerHTML = `
    <div class="animate-fade-in">
        <button class="secondary" id="backToWatchlist" style="margin-bottom:16px;">← Back to Watchlist</button>
        <div class="card">
            <div style="display:grid; grid-template-columns:minmax(180px, 280px) 1fr; gap:20px;">
                ${item.productImageUrl ? `<img class="watchlist-image" src="${escapeHtml(item.productImageUrl)}" alt="${escapeHtml(item.displayName)}">` : `<div class="watchlist-image placeholder">${type.icon}</div>`}
                <div>
                    <span class="badge ${type.badge}">${type.icon} ${type.label}</span>
                    <h2 style="margin-top:12px;">${escapeHtml(item.displayName)}</h2>
                    <p class="muted">${escapeHtml(item.reason || '—')}</p>
                    <div class="watchlist-meta" style="margin-top:16px;">
                        <span>${escapeHtml(item.alertRef || 'No reference')}</span>
                        <span>${escapeHtml(formatCoverage(item))}</span>
                    </div>
                    <div class="watchlist-instructions">${escapeHtml(item.instructions || 'No field instructions supplied.')}</div>
                </div>
            </div>
        </div>
        <div class="card" style="padding:0; overflow:auto;">
            <table>
                <thead>
                    <tr><th>Date</th><th>State</th><th>Facility</th><th>Outcome</th><th>Details</th></tr>
                </thead>
                <tbody>${rows || `<tr><td colspan="5" style="text-align:center; padding:28px;">No field response has been recorded yet.</td></tr>`}</tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('backToWatchlist').onclick = () => loadWatchlistDashboard(container, currentUserData);
}

function formatCoverage(item) {
    if (item.scope === 'nationwide') return 'Nationwide';
    if (item.scope === 'selected_states') return `${(item.targetStates || []).length} selected states`;
    if (item.scope === 'zone') return item.zone || 'Zone';
    return item.state ? `${item.state} State` : 'State';
}

function renderWatchlistForm(container, currentUser, currentUserData) {
    const fields = [
        { name: "dateIssued", label: "Date Issued", type: "date", required: true },
        { name: "alertRef", label: "Reference No.", type: "text", required: true },
        { name: "productName", label: "Product / Company / Subject", type: "text", required: true, hint: "This is what officers will select during surveillance" },
        { name: "productImageUrl", label: "Image / Evidence Link", type: "text", hint: "Photo, advert screenshot, recall notice, or supporting document link" },
        { name: "batchNo", label: "Batch / Lot No.", type: "text" },
        { name: "nafdacRegNo", label: "NAFDAC Reg. No.", type: "text" },
        { name: "manufacturer", label: "Manufacturer / Company", type: "text" },
        { name: "reason", label: "Reason / Risk", type: "textarea", required: true },
        { name: "instructions", label: "Field Instructions", type: "textarea", required: true }
    ];

    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom:4px;">🎯 New Watchlist Item</h2>
        <p class="muted small" style="margin-bottom:20px;">Create a focused item for officers to verify during routine surveillance.</p>
        <form id="watchlistForm">
            <div class="form-row">
                <div class="form-group">
                    <label style="color:var(--primary); font-weight:700;">Type</label>
                    <select name="itemType" required>
                        ${Object.entries(WATCHLIST_TYPES).map(([value, cfg]) => `<option value="${value}">${cfg.icon} ${cfg.label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label style="color:var(--primary); font-weight:700;">Priority</label>
                    <select name="priority" required>
                        ${['Critical', 'High', 'Medium', 'Low'].map(p => `<option ${p === 'Medium' ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label style="color:var(--primary); font-weight:700;">Coverage</label>
                    <select name="scope" id="alertScope" required>
                        <option value="state">My State</option>
                        <option value="zone">My Zone</option>
                        <option value="selected_states">Selected States</option>
                        <option value="nationwide">Nationwide</option>
                    </select>
                    <div class="input-hint">Nationwide items from states are submitted for HQ approval before phone push.</div>
                </div>
                <div class="form-group" id="targetStatesGroup" style="display:none;">
                    <label style="color:var(--primary); font-weight:700;">Target States</label>
                    <select name="targetStates" multiple data-choices="true">
                        ${ALL_STATES.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
                    </select>
                </div>
            </div>
            ${buildFormFields(fields, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content:flex-end; margin-top:20px; gap:12px;">
                <button type="button" class="secondary" id="cancelAlert">Cancel</button>
                <button type="submit" class="success">Broadcast / Submit</button>
            </div>
        </form>
    </div>`;

    document.getElementById('cancelAlert').onclick = () => loadWatchlistDashboard(container, currentUserData);
    const scopeSelect = document.getElementById('alertScope');
    const targetStatesGroup = document.getElementById('targetStatesGroup');
    scopeSelect.onchange = () => {
        targetStatesGroup.style.display = scopeSelect.value === 'selected_states' ? 'block' : 'none';
    };
    initFormChoices(container);

    document.getElementById('watchlistForm').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = {};

        fields.forEach(f => {
            const el = form.querySelector(`[name="${f.name}"]`);
            if (el) data[f.name] = el.value;
        });

        data.itemType = form.itemType.value;
        data.priority = form.priority.value;
        data.scope = form.scope.value;
        data.targetStates = Array.from(form.querySelector('[name="targetStates"]')?.selectedOptions || []).map(o => o.value);
        data.approvalStatus = data.scope === 'nationwide' && !['admin', 'national_admin'].includes(currentUserData?.role)
            ? 'pending_national_approval'
            : 'approved';
        data.state = currentUserData?.state || '';
        data.zone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            const ref = await addDoc(collection(db, 'alerts'), data);
            const message = data.approvalStatus === 'pending_national_approval'
                ? 'Submitted to HQ for nationwide approval.'
                : 'Watchlist item sent to affected officers.';
            showToast('Watchlist Saved', message, 'success');
            if (data.approvalStatus === 'approved') {
                triggerServerPush('watchlist', ref.id).catch(err => {
                    showToast('Phone Push Not Sent', err.message, 'warning', 7000);
                });
            }
            loadWatchlistDashboard(container, currentUserData);
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}
