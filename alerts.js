/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — ALERTS INTELLIGENCE MODULE
 * Officers log product alerts; intelligence table tracks matching 
 * products found during routine surveillance nationwide.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, getDocs, query, where, serverTimestamp } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, buildFormFields } from "./ui.js";

export async function loadAlertsPage(root, currentUser, currentUserData) {
    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 1000px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
                <h1 style="margin-bottom:4px;">🚨 Alerts Intelligence</h1>
                <p class="muted small">Product alert tracking and nationwide discovery mapping.</p>
            </div>
            <div style="display:flex; gap:8px;">
                <button id="btnNewAlert">+ Log Alert</button>
            </div>
        </div>

        <div id="alertsContent"></div>
    </div>`;

    const content = document.getElementById('alertsContent');

    document.getElementById('btnNewAlert').onclick = () => renderAlertForm(content, currentUser, currentUserData);

    await loadAlertsDashboard(content);
}

async function loadAlertsDashboard(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div></div>';
    const scope = getUserScope();

    try {
        // Build scoped queries
        let alertQ, reportQ;
        if (scope.state) {
            alertQ = query(collection(db, 'alerts'), where('state', '==', scope.state));
            reportQ = query(collection(db, 'facilityReports'), where('state', '==', scope.state));
        } else if (scope.zone) {
            alertQ = query(collection(db, 'alerts'), where('zone', '==', scope.zone));
            reportQ = query(collection(db, 'facilityReports'), where('zone', '==', scope.zone));
        } else {
            alertQ = query(collection(db, 'alerts'));
            reportQ = query(collection(db, 'facilityReports'));
        }

        const alertsSnap = await getDocs(alertQ);
        const activeAlerts = alertsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const reportsSnap = await getDocs(reportQ);
        const allReports = reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        const discoveries = allReports.filter(r => 
            r.activityKey === 'routine_surveillance' && 
            r.conditionalData?.alertProductFound === 'yes' &&
            r.conditionalData?.alertProduct
        );

        if (activeAlerts.length === 0) {
            container.innerHTML = `
            <div class="card" style="text-align:center; padding:48px;">
                <div style="font-size:48px; margin-bottom:12px;">🚨</div>
                <h3>No Active Alerts</h3>
                <p class="muted small">Click "+ Log Alert" to broadcast a product alert for surveillance.</p>
            </div>`;
            return;
        }

        // Map discoveries to alerts
        // This is a simple exact match by productName
        const intelligenceData = activeAlerts.map(alert => {
            const hits = discoveries.filter(d => d.conditionalData.alertProduct === alert.productName);
            return {
                ...alert,
                discoveries: hits.length,
                statesFound: [...new Set(hits.map(h => h.state))].filter(Boolean)
            };
        });

        container.innerHTML = `
        <div class="card" style="padding: 0; overflow: auto;">
            <table style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: var(--bg-tertiary); text-align:left;">
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">DATE ISSUED</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">PRODUCT / ALERT NO.</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">REASON</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">HITS</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">LOCATIONS FOUND</th>
                    </tr>
                </thead>
                <tbody>
                    ${intelligenceData.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0)).map(a => `
                    <tr style="border-top:1px solid var(--border-subtle);">
                        <td style="padding:12px 16px; font-size:13px;">${a.dateIssued || '—'}</td>
                        <td style="padding:12px 16px;">
                            <div style="font-size:13px; font-weight:700;">${a.productName || '—'}</div>
                            <div class="muted small">${a.alertRef || 'No Reference'}</div>
                        </td>
                        <td style="padding:12px 16px; font-size:13px;">${a.reason || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">
                            <span class="badge ${a.discoveries > 0 ? 'badge-red' : 'badge-green'}">${a.discoveries} Found</span>
                        </td>
                        <td style="padding:12px 16px; font-size:13px;">
                            ${a.statesFound.length > 0 ? a.statesFound.join(', ') : '<span class="muted">—</span>'}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    } catch (err) {
        console.error("Alerts error:", err);
        container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderAlertForm(container, currentUser, currentUserData) {
    const fields = [
        { name: "dateIssued", label: "Date Issued", type: "date", required: true },
        { name: "alertRef", label: "Alert Reference No.", type: "text", required: true },
        { name: "productName", label: "Product Name", type: "text", required: true, hint: "Exact name to be matched in the field" },
        { name: "reason", label: "Reason for Alert", type: "textarea", required: true },
        { name: "instructions", label: "Field Instructions", type: "textarea" }
    ];

    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">🚨 Provide New Alert</h2>
        <p class="muted small" style="margin-bottom: 20px;">Broadcasting an alert will automatically populate it across all officer's routine surveillance forms.</p>
        <form id="alertForm">
            ${buildFormFields(fields, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
                <button type="button" class="secondary" id="cancelAlert">Cancel</button>
                <button type="submit" class="success">Broadcast Alert</button>
            </div>
        </form>
    </div>`;

    document.getElementById('cancelAlert').onclick = () => loadAlertsDashboard(container);

    document.getElementById('alertForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {};
        fields.forEach(f => {
            const el = e.target.querySelector(`[name="${f.name}"]`);
            if (el) data[f.name] = el.value;
        });
        
        data.state = currentUserData?.state || '';
        data.zone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            await addDoc(collection(db, 'alerts'), data);
            showToast('Broadcasted', 'Alert sent to field operations.', 'success');
            loadAlertsDashboard(container);
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}
