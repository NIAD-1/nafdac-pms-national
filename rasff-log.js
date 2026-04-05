/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — RASFF LOG MODULE
 * Log RASFF reference entries.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, getDocs, query, where, serverTimestamp } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, buildFormFields, initFormChoices } from "./ui.js";
import { RASFF_FIELDS, getTodayStr } from "./constants.js";

export async function loadRasffPage(root, currentUser, currentUserData) {
    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 900px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
                <h1 style="margin-bottom:4px;">🌐 RASFF Log</h1>
                <p class="muted small">Rapid Alert System for Food and Feed — Reference Log</p>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="secondary" id="btnViewRasff">📋 View All</button>
                <button id="btnNewRasff">+ New Entry</button>
            </div>
        </div>
        <div id="rasffContent"></div>
    </div>`;

    const content = document.getElementById('rasffContent');

    document.getElementById('btnNewRasff').onclick = () => renderRasffForm(content, currentUser, currentUserData);
    document.getElementById('btnViewRasff').onclick = () => loadRasffList(content);

    await loadRasffList(content);
}

async function loadRasffList(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div></div>';
    const scope = getUserScope();

    try {
        let q;
        if (scope.state) q = query(collection(db, 'rasffLogs'), where('state', '==', scope.state));
        else if (scope.zone) q = query(collection(db, 'rasffLogs'), where('zone', '==', scope.zone));
        else q = query(collection(db, 'rasffLogs'));

        const snap = await getDocs(q);
        const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (entries.length === 0) {
            container.innerHTML = `
            <div class="card" style="text-align:center; padding:48px;">
                <div style="font-size:48px; margin-bottom:12px;">🌐</div>
                <h3>No RASFF Entries Yet</h3>
                <p class="muted small">Click "+ New Entry" to log a RASFF reference.</p>
            </div>`;
            return;
        }

        container.innerHTML = `
        <div class="card" style="padding: 0; overflow: auto;">
            <table style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: var(--bg-tertiary); text-align:left;">
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">DATE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">REF NO.</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">COUNTRY</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">PRODUCT</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">CONTAMINANT</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(e => `
                    <tr style="border-top:1px solid var(--border-subtle);">
                        <td style="padding:12px 16px; font-size:13px;">${e.dateOfCase || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px; font-weight:600;">${e.refNo || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${e.notifyingCountry || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${e.productType || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${e.contaminant || '—'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    } catch (err) {
        container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderRasffForm(container, currentUser, currentUserData) {
    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">🌐 New RASFF Entry</h2>
        <p class="muted small" style="margin-bottom: 20px;">Log a RASFF reference entry.</p>
        <form id="rasffForm">
            ${buildFormFields(RASFF_FIELDS, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
                <button type="button" class="secondary" id="cancelRasff">Cancel</button>
                <button type="submit" class="success">Submit</button>
            </div>
        </form>
    </div>`;

    initFormChoices(container);

    document.getElementById('cancelRasff').onclick = () => loadRasffList(container);

    document.getElementById('rasffForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {};
        RASFF_FIELDS.forEach(f => {
            const el = e.target.querySelector(`[name="${f.name}"]`);
            if (el) data[f.name] = el.value;
        });
        data.state = currentUserData?.state || '';
        data.zone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            await addDoc(collection(db, 'rasffLogs'), data);
            showToast('Logged', 'RASFF entry saved.', 'success');
            loadRasffList(container);
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}
