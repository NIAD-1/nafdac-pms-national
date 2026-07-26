/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — LOG COMPLAINTS MODULE
 * Officers can log consumer complaints and update them any day.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, getDocs, query, where, doc, updateDoc, serverTimestamp } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, buildFormFields, initFormChoices, escapeHtml } from "./ui.js";
import { ALL_STATES, COMPLAINT_FIELDS, getTodayStr, getZoneForState } from "./constants.js";
import { triggerServerPush } from "./server-push.js";

export async function loadComplaintsPage(root, currentUser, currentUserData) {
    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 900px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
                <h1 style="margin-bottom:4px;">📝 Log Complaints</h1>
                <p class="muted small">Record consumer complaints. Action taken can be updated any day.</p>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="secondary" id="btnViewComplaints">📋 View All</button>
                <button id="btnNewComplaint">+ New Complaint</button>
            </div>
        </div>

        <div id="complaintsContent"></div>
    </div>`;

    const content = document.getElementById('complaintsContent');
    const scope = getUserScope();

    document.getElementById('btnNewComplaint').onclick = () => renderComplaintForm(content, currentUser, currentUserData);
    document.getElementById('btnViewComplaints').onclick = () => loadComplaintsList(content, scope);

    const focusComplaintId = sessionStorage.getItem('focusComplaintId');
    if (focusComplaintId) {
        sessionStorage.removeItem('focusComplaintId');
        const focused = await findComplaintById(focusComplaintId, scope);
        if (focused) {
            renderUpdateForm(content, focused, scope);
            return;
        }
    }

    await loadComplaintsList(content, scope);
}

async function findComplaintById(id, scope) {
    const complaints = await fetchScopedComplaints(scope);
    return complaints.find(c => c.id === id) || null;
}

// Logic moved to auth.js global utility

async function fetchScopedComplaints(scope) {
    if (!scope.state && !scope.zone) {
        const snap = await getDocs(query(collection(db, 'complaints')));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const queries = scope.state
        ? [
            query(collection(db, 'complaints'), where('state', '==', scope.state)),
            query(collection(db, 'complaints'), where('originState', '==', scope.state))
        ]
        : [
            query(collection(db, 'complaints'), where('zone', '==', scope.zone)),
            query(collection(db, 'complaints'), where('originZone', '==', scope.zone))
        ];

    const results = await Promise.all(queries.map(q => getDocs(q)));
    const byId = new Map();
    results.forEach(snap => snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() })));
    return [...byId.values()];
}

async function loadComplaintsList(container, scope) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div><p class="muted" style="margin-top:12px;">Loading complaints...</p></div>';

    try {
        const complaints = await fetchScopedComplaints(scope);

        if (complaints.length === 0) {
            container.innerHTML = `
            <div class="card" style="text-align:center; padding:48px;">
                <div style="font-size:48px; margin-bottom:12px;">📭</div>
                <h3>No Complaints Logged Yet</h3>
                <p class="muted small">Click "+ New Complaint" to record your first consumer complaint.</p>
            </div>`;
            return;
        }

        const statusBadge = (s) => {
            const colors = { 'Open': 'badge-red', 'Under Investigation': 'badge-yellow', 'Worked On': 'badge-blue', 'Closed': 'badge-green' };
            return `<span class="badge ${colors[s] || ''}">${s}</span>`;
        };

        const openCount = complaints.filter(c => (c.status || 'Open') === 'Open').length;
        const activeCount = complaints.filter(c => ['Open', 'Under Investigation'].includes(c.status || 'Open')).length;

        container.innerHTML = `
        <div class="complaint-command-strip">
            <div>
                <strong>${activeCount} active complaint${activeCount === 1 ? '' : 's'}</strong>
                <span>${openCount} waiting for first response</span>
            </div>
            <button class="secondary" id="btnOpenComplaintQueue">Open Response Queue</button>
        </div>
        <div class="card" style="padding: 0; overflow: auto;">
            <table style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: var(--bg-tertiary); text-align:left;">
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">DATE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">PRODUCT</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">NATURE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">FACILITY</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">STATE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">STATUS</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">ACTION</th>
                    </tr>
                </thead>
                <tbody>
                    ${complaints.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(c => `
                    <tr style="border-top:1px solid var(--border-subtle);">
                        <td style="padding:12px 16px; font-size:13px;">${escapeHtml(c.dateLogged || '—')}</td>
                        <td style="padding:12px 16px; font-size:13px; font-weight:600;">${escapeHtml(c.productName || '—')}</td>
                        <td style="padding:12px 16px; font-size:13px;">${escapeHtml(c.natureOfComplaint || '—')}</td>
                        <td style="padding:12px 16px; font-size:13px;">${escapeHtml(c.facilityName || '—')}</td>
                        <td style="padding:12px 16px; font-size:13px;">${escapeHtml(c.state || '—')}</td>
                        <td style="padding:12px 16px;">${statusBadge(c.status)}</td>
                        <td style="padding:12px 16px;">
                            <button class="secondary" style="padding:4px 12px; font-size:11px;" data-edit="${c.id}">Update</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

        // Edit buttons
        container.querySelectorAll('[data-edit]').forEach(btn => {
            btn.onclick = () => {
                const c = complaints.find(x => x.id === btn.dataset.edit);
                if (c) renderUpdateForm(container, c, scope);
            };
        });

        document.getElementById('btnOpenComplaintQueue')?.addEventListener('click', () => {
            const firstOpen = complaints.find(c => ['Open', 'Under Investigation'].includes(c.status || 'Open'));
            if (firstOpen) renderUpdateForm(container, firstOpen, scope);
            else showToast('Queue Clear', 'No open complaint needs response in your scope.', 'success');
        });

    } catch (err) {
        console.error("Complaints load error:", err);
        container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderComplaintForm(container, currentUser, currentUserData) {
    const canAssignState = !currentUserData?.state;
    const stateAssignmentHtml = canAssignState ? `
        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Responsible State <span style="color:var(--danger);">*</span></label>
            <select name="assignedState" required>
                <option value="">Select state to respond...</option>
                ${ALL_STATES.map(state => `<option value="${escapeHtml(state)}">${escapeHtml(state)}</option>`).join('')}
            </select>
            <div class="input-hint">The selected state will see this complaint in its action alerts.</div>
        </div>` : '';

    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">📝 New Consumer Complaint</h2>
        <p class="muted small" style="margin-bottom: 20px;">Fill in the complaint details. You can update action taken later.</p>
        <form id="complaintForm">
            ${stateAssignmentHtml}
            ${buildFormFields(COMPLAINT_FIELDS, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
                <button type="button" class="secondary" id="cancelComplaint">Cancel</button>
                <button type="submit" class="success">Submit Complaint</button>
            </div>
        </form>
    </div>`;

    initFormChoices(container);
    const statusSelect = container.querySelector('[name="status"]');
    if (statusSelect && !statusSelect.value) statusSelect.value = 'Open';

    document.getElementById('cancelComplaint').onclick = () => {
        loadComplaintsList(container, getUserScope());
    };

    document.getElementById('complaintForm').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = {};
        COMPLAINT_FIELDS.forEach(f => {
            const el = form.querySelector(`[name="${f.name}"]`);
            if (el) data[f.name] = el.value;
        });

        data.dateLogged = getTodayStr();
        const assignedState = form.querySelector('[name="assignedState"]')?.value || currentUserData?.state || '';
        data.state = assignedState;
        data.zone = getZoneForState(assignedState) || currentUserData?.zone || '';
        data.originState = currentUserData?.state || '';
        data.originZone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            const ref = await addDoc(collection(db, 'complaints'), data);
            showToast('Complaint Logged', `${data.state || 'The responsible state'} now has a complaint to respond to.`, 'success');
            triggerServerPush('complaint', ref.id).catch(err => {
                showToast('Phone Push Not Sent', err.message, 'warning', 7000);
            });
            loadComplaintsList(container, getUserScope());
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}

function renderUpdateForm(container, complaint, scope = getUserScope()) {
    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">✏️ Update Complaint</h2>
        <p class="muted small" style="margin-bottom: 20px;">Update action taken or status for: <strong>${escapeHtml(complaint.productName)}</strong></p>

        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 20px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div><span class="muted small">Product:</span><br><strong>${escapeHtml(complaint.productName || '—')}</strong></div>
                <div><span class="muted small">Nature:</span><br><strong>${escapeHtml(complaint.natureOfComplaint || '—')}</strong></div>
                <div><span class="muted small">Facility:</span><br><strong>${escapeHtml(complaint.facilityName || '—')}</strong></div>
                <div><span class="muted small">Responsible State:</span><br><strong>${escapeHtml(complaint.state || '—')}</strong></div>
                <div><span class="muted small">Origin State:</span><br><strong>${escapeHtml(complaint.originState || complaint.state || 'National')}</strong></div>
                <div><span class="muted small">Date Logged:</span><br><strong>${escapeHtml(complaint.dateLogged || '—')}</strong></div>
            </div>
        </div>

        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Action Taken</label>
            <textarea name="actionTaken" rows="4" placeholder="Describe actions taken...">${escapeHtml(complaint.actionTaken || '')}</textarea>
        </div>
        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Status</label>
            <select name="status">
                ${['Open', 'Under Investigation', 'Worked On', 'Closed'].map(s => `<option ${complaint.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Response Document Link</label>
            <input type="url" name="responseDocumentUrl" placeholder="https://..." value="${escapeHtml(complaint.responseDocumentUrl || '')}">
            <div class="input-hint">Paste the report, memo, evidence folder, or uploaded response document link.</div>
        </div>
        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Remarks</label>
            <textarea name="remarks" rows="2">${escapeHtml(complaint.remarks || '')}</textarea>
        </div>
        ${complaint.responseDocumentUrl ? `<div class="complaint-response-link"><span>Current response document</span><a href="${escapeHtml(complaint.responseDocumentUrl)}" target="_blank" rel="noopener">Open Document</a></div>` : ''}
        <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
            <button class="secondary" id="cancelUpdate">Cancel</button>
            <button class="success" id="saveUpdate">💾 Save Update</button>
        </div>
    </div>`;

    document.getElementById('cancelUpdate').onclick = () => {
        loadComplaintsList(container, scope);
    };

    document.getElementById('saveUpdate').onclick = async () => {
        const actionTaken = container.querySelector('[name="actionTaken"]').value;
        const status = container.querySelector('[name="status"]').value;
        const responseDocumentUrl = container.querySelector('[name="responseDocumentUrl"]').value.trim();
        const remarks = container.querySelector('[name="remarks"]').value;

        try {
            await updateDoc(doc(db, 'complaints', complaint.id), {
                actionTaken, status, responseDocumentUrl, remarks, updatedAt: serverTimestamp()
            });
            const message = status === 'Worked On' || status === 'Closed'
                ? 'Submitting state can now see the response and document link.'
                : 'Complaint updated successfully.';
            showToast('Updated', message, 'success');
            loadComplaintsList(container, scope);
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}
