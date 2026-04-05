/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — LOG ADVERTS MODULE
 * Monitor and log advertisement & promotional activities.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, getDocs, query, where, serverTimestamp } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, showLoading, buildFormFields, initFormChoices } from "./ui.js";
import { ADVERT_FIELDS, getTodayStr } from "./constants.js";

export async function loadAdvertsPage(root, currentUser, currentUserData) {
    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 900px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
                <h1 style="margin-bottom:4px;">📺 Log Adverts</h1>
                <p class="muted small">Monitor and log advertisement & promotional activities.</p>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="secondary" id="btnViewAdverts">📋 View All</button>
                <button id="btnNewAdvert">+ New Entry</button>
            </div>
        </div>
        <div id="advertsContent"></div>
    </div>`;

    const content = document.getElementById('advertsContent');

    document.getElementById('btnNewAdvert').onclick = () => renderAdvertForm(content, currentUser, currentUserData);
    document.getElementById('btnViewAdverts').onclick = () => loadAdvertsList(content, currentUserData);

    await loadAdvertsList(content, currentUserData);
}

async function loadAdvertsList(container, userData) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div></div>';
    const scope = getUserScope();

    try {
        let q;
        if (scope.state) {
            q = query(collection(db, 'advertLogs'), where('state', '==', scope.state));
        } else if (scope.zone) {
            q = query(collection(db, 'advertLogs'), where('zone', '==', scope.zone));
        } else {
            q = query(collection(db, 'advertLogs'));
        }

        const snap = await getDocs(q);
        const adverts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (adverts.length === 0) {
            container.innerHTML = `
            <div class="card" style="text-align:center; padding:48px;">
                <div style="font-size:48px; margin-bottom:12px;">📺</div>
                <h3>No Advert Logs Yet</h3>
                <p class="muted small">Click "+ New Entry" to log an advertisement.</p>
            </div>`;
            return;
        }

        container.innerHTML = `
        <div class="card" style="padding: 0; overflow: auto;">
            <table style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: var(--bg-tertiary); text-align:left;">
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">DATE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">COMPANY</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">PRODUCT</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">TYPE</th>
                        <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">VIOLATIONS</th>
                    </tr>
                </thead>
                <tbody>
                    ${adverts.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(a => `
                    <tr style="border-top:1px solid var(--border-subtle);">
                        <td style="padding:12px 16px; font-size:13px;">${a.dateLogged || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px; font-weight:600;">${a.companyName || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${a.productName || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${a.adType || '—'}</td>
                        <td style="padding:12px 16px; font-size:13px;">${a.violations ? '<span class="badge badge-red">Yes</span>' : '<span class="badge badge-green">None</span>'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    } catch (err) {
        container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderAdvertForm(container, currentUser, currentUserData) {
    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">📺 New Advert Log</h2>
        <p class="muted small" style="margin-bottom: 20px;">Log an advertisement or promotional activity.</p>
        <form id="advertForm">
            ${buildFormFields(ADVERT_FIELDS, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
                <button type="button" class="secondary" id="cancelAdvert">Cancel</button>
                <button type="submit" class="success">Submit</button>
            </div>
        </form>
    </div>`;

    initFormChoices(container);

    document.getElementById('cancelAdvert').onclick = () => loadAdvertsList(container, currentUserData);

    document.getElementById('advertForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {};
        ADVERT_FIELDS.forEach(f => {
            const el = e.target.querySelector(`[name="${f.name}"]`);
            if (el) data[f.name] = el.value;
        });
        data.dateLogged = getTodayStr();
        data.state = currentUserData?.state || '';
        data.zone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            await addDoc(collection(db, 'advertLogs'), data);
            showToast('Logged', 'Advert entry saved.', 'success');
            loadAdvertsList(container, currentUserData);
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}
