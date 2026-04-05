/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — LOG COMPLAINTS MODULE
 * Officers can log consumer complaints and update them any day.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, getDocs, query, where, doc, updateDoc, serverTimestamp } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, showLoading, buildFormFields, initFormChoices } from "./ui.js";
import { COMPLAINT_FIELDS, PRODUCT_CATEGORIES, getTodayStr } from "./constants.js";

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

    // Default to list view
    await loadComplaintsList(content, scope);
}

// Logic moved to auth.js global utility

async function loadComplaintsList(container, scope) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div><p class="muted" style="margin-top:12px;">Loading complaints...</p></div>';

    try {
        let q;
        if (scope.state) q = query(collection(db, 'complaints'), where('state', '==', scope.state));
        else if (scope.zone) q = query(collection(db, 'complaints'), where('zone', '==', scope.zone));
        else q = query(collection(db, 'complaints'));

        const snap = await getDocs(q);
        const complaints = snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
            const colors = { 'Open': 'badge-red', 'Under Investigation': 'badge-yellow', 'Closed': 'badge-green' };
            return `<span class="badge ${colors[s] || ''}">${s}</span>`;
        };

        container.innerHTML = `
        <div class="card" style="padding: 0; overflow: auto;">
            <table style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: var(--bg-tertiary); text-align:left;">
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">DATE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">PRODUCT</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">NATURE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">FACILITY</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">STATUS</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">ACTION</th>
                    </tr>
                </thead>
                <tbody>
                    ${complaints.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(c => `
                    <tr style="border-top:1px solid var(--border-subtle);">
                        <td style="padding:12px 16px; font-size:13px;">${c.dateLogged || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px; font-weight:600;">${c.productName || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${c.natureOfComplaint || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${c.facilityName || '—'}</td>
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
                if (c) renderUpdateForm(container, c);
            };
        });

    } catch (err) {
        console.error("Complaints load error:", err);
        container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderComplaintForm(container, currentUser, currentUserData) {
    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">📝 New Consumer Complaint</h2>
        <p class="muted small" style="margin-bottom: 20px;">Fill in the complaint details. You can update action taken later.</p>
        <form id="complaintForm">
            ${buildFormFields(COMPLAINT_FIELDS, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
                <button type="button" class="secondary" id="cancelComplaint">Cancel</button>
                <button type="submit" class="success">Submit Complaint</button>
            </div>
        </form>
    </div>`;

    initFormChoices(container);

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
        data.state = currentUserData?.state || '';
        data.zone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            await addDoc(collection(db, 'complaints'), data);
            showToast('Complaint Logged', 'Consumer complaint has been recorded.', 'success');
            loadComplaintsList(container, getUserScope());
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}

function renderUpdateForm(container, complaint) {
    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">✏️ Update Complaint</h2>
        <p class="muted small" style="margin-bottom: 20px;">Update action taken or status for: <strong>${complaint.productName}</strong></p>

        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 20px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div><span class="muted small">Product:</span><br><strong>${complaint.productName || '—'}</strong></div>
                <div><span class="muted small">Nature:</span><br><strong>${complaint.natureOfComplaint || '—'}</strong></div>
                <div><span class="muted small">Facility:</span><br><strong>${complaint.facilityName || '—'}</strong></div>
                <div><span class="muted small">Date Logged:</span><br><strong>${complaint.dateLogged || '—'}</strong></div>
            </div>
        </div>

        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Action Taken</label>
            <textarea name="actionTaken" rows="4" placeholder="Describe actions taken...">${complaint.actionTaken || ''}</textarea>
        </div>
        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Status</label>
            <select name="status">
                ${['Open', 'Under Investigation', 'Closed'].map(s => `<option ${complaint.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label style="color:var(--primary); font-weight:700;">Remarks</label>
            <textarea name="remarks" rows="2">${complaint.remarks || ''}</textarea>
        </div>
        <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
            <button class="secondary" id="cancelUpdate">Cancel</button>
            <button class="success" id="saveUpdate">💾 Save Update</button>
        </div>
    </div>`;

    document.getElementById('cancelUpdate').onclick = () => {
        loadComplaintsList(container, {});
    };

    document.getElementById('saveUpdate').onclick = async () => {
        const actionTaken = container.querySelector('[name="actionTaken"]').value;
        const status = container.querySelector('[name="status"]').value;
        const remarks = container.querySelector('[name="remarks"]').value;

        try {
            await updateDoc(doc(db, 'complaints', complaint.id), {
                actionTaken, status, remarks, updatedAt: serverTimestamp()
            });
            showToast('Updated', 'Complaint updated successfully.', 'success');
            loadComplaintsList(container, {});
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}
