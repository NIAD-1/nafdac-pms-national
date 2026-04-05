/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — MEETINGS, TRAININGS & QMS MODULE
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, getDocs, query, where, serverTimestamp } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, buildFormFields, initFormChoices } from "./ui.js";
import { MEETING_FIELDS, QMS_FIELDS, getTodayStr } from "./constants.js";

export async function loadMeetingsPage(root, currentUser, currentUserData) {
    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 900px; margin: 0 auto;">
        <div style="margin-bottom: 20px;">
            <h1 style="margin-bottom:4px;">📚 Meetings, Trainings & QMS</h1>
            <p class="muted small">Log meetings, workshops, trainings, and QMS activities.</p>
        </div>

        <!-- Tabs -->
        <div style="display:flex; gap:8px; margin-bottom:20px;">
            <button class="tab-btn active" data-tab="meetings" style="padding:10px 20px; border-radius: var(--radius-sm); cursor:pointer;">📚 Meetings / Trainings</button>
            <button class="tab-btn" data-tab="qms" style="padding:10px 20px; border-radius: var(--radius-sm); cursor:pointer;">✅ QMS Activities</button>
        </div>

        <div id="meetingsContent"></div>
    </div>`;

    const content = document.getElementById('meetingsContent');
    let activeTab = 'meetings';

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.dataset.tab;
            if (activeTab === 'meetings') loadMeetingsList(content, currentUser, currentUserData);
            else loadQmsList(content, currentUser, currentUserData);
        };
    });

    await loadMeetingsList(content, currentUser, currentUserData);
}

// ── MEETINGS LIST & FORM ────────────────────────────────────────
async function loadMeetingsList(container, currentUser, currentUserData) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div></div>';
    const scope = getUserScope();

    try {
        let q;
        if (scope.state) q = query(collection(db, 'meetingLogs'), where('state', '==', scope.state));
        else if (scope.zone) q = query(collection(db, 'meetingLogs'), where('zone', '==', scope.zone));
        else q = query(collection(db, 'meetingLogs'));

        const snap = await getDocs(q);
        const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        let listHtml = '';
        if (entries.length === 0) {
            listHtml = `<div class="card" style="text-align:center; padding:40px;">
                <div style="font-size:40px; margin-bottom:8px;">📚</div>
                <h3>No Meetings Logged</h3>
                <p class="muted small">Click the button below to log a meeting or training.</p>
            </div>`;
        } else {
            listHtml = `
            <div class="card" style="padding: 0; overflow: auto;">
                <table style="width:100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--bg-tertiary); text-align:left;">
                            <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">DATE</th>
                            <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">TITLE</th>
                            <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">VENUE</th>
                            <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">FACILITATOR</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${entries.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(e => `
                        <tr style="border-top:1px solid var(--border-subtle);">
                            <td style="padding:12px 16px; font-size:13px;">${e.meetingDate || '—'}</td>
                            <td style="padding:12px 16px; font-size:13px; font-weight:600;">${e.title || '—'}</td>
                            <td style="padding:12px 16px; font-size:13px;">${e.venue || '—'}</td>
                            <td style="padding:12px 16px; font-size:13px;">${e.facilitator || '—'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        container.innerHTML = `
        ${listHtml}
        <div style="margin-top:16px; text-align:right;">
            <button id="btnNewMeeting">+ Log Meeting / Training</button>
        </div>`;

        document.getElementById('btnNewMeeting').onclick = () => renderMeetingForm(container, currentUser, currentUserData);

    } catch (err) {
        container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderMeetingForm(container, currentUser, currentUserData) {
    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">📚 New Meeting / Training</h2>
        <p class="muted small" style="margin-bottom: 20px;">Log a meeting, workshop, or training session.</p>
        <form id="meetingForm">
            ${buildFormFields(MEETING_FIELDS, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
                <button type="button" class="secondary" id="cancelMeeting">Cancel</button>
                <button type="submit" class="success">Submit</button>
            </div>
        </form>
    </div>`;

    document.getElementById('cancelMeeting').onclick = () => loadMeetingsList(container, currentUser, currentUserData);

    document.getElementById('meetingForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {};
        MEETING_FIELDS.forEach(f => {
            const el = e.target.querySelector(`[name="${f.name}"]`);
            if (el) data[f.name] = el.value;
        });
        data.state = currentUserData?.state || '';
        data.zone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            await addDoc(collection(db, 'meetingLogs'), data);
            showToast('Logged', 'Meeting entry saved.', 'success');
            loadMeetingsList(container, currentUser, currentUserData);
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}

// ── QMS LIST & FORM ─────────────────────────────────────────────
async function loadQmsList(container, currentUser, currentUserData) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div></div>';
    const scope = getUserScope();

    try {
        let q;
        if (scope.state) q = query(collection(db, 'qmsLogs'), where('state', '==', scope.state));
        else if (scope.zone) q = query(collection(db, 'qmsLogs'), where('zone', '==', scope.zone));
        else q = query(collection(db, 'qmsLogs'));

        const snap = await getDocs(q);
        const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        let listHtml = '';
        if (entries.length === 0) {
            listHtml = `<div class="card" style="text-align:center; padding:40px;">
                <div style="font-size:40px; margin-bottom:8px;">✅</div>
                <h3>No QMS Activities Logged</h3>
                <p class="muted small">Click the button below to log a QMS activity.</p>
            </div>`;
        } else {
            listHtml = `
            <div class="card" style="padding: 0; overflow: auto;">
                <table style="width:100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--bg-tertiary); text-align:left;">
                            <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">DATE</th>
                            <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">ACTIVITY</th>
                            <th style="padding:12px 16px; font-size:12px; color:var(--text-secondary);">LOGGED BY</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${entries.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(e => `
                        <tr style="border-top:1px solid var(--border-subtle);">
                            <td style="padding:12px 16px; font-size:13px;">${e.qmsDate || '—'}</td>
                            <td style="padding:12px 16px; font-size:13px;">${(e.qmsActivity || '—').substring(0, 80)}${e.qmsActivity?.length > 80 ? '...' : ''}</td>
                            <td style="padding:12px 16px; font-size:13px;">${e.createdByName || '—'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        container.innerHTML = `
        ${listHtml}
        <div style="margin-top:16px; text-align:right;">
            <button id="btnNewQms">+ Log QMS Activity</button>
        </div>`;

        document.getElementById('btnNewQms').onclick = () => renderQmsForm(container, currentUser, currentUserData);

    } catch (err) {
        container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderQmsForm(container, currentUser, currentUserData) {
    container.innerHTML = `
    <div class="card animate-fade-in">
        <h2 style="margin-bottom: 4px;">✅ New QMS Activity</h2>
        <p class="muted small" style="margin-bottom: 20px;">Log a Quality Management System activity.</p>
        <form id="qmsForm">
            ${buildFormFields(QMS_FIELDS, { labelStyle: 'color:var(--primary); font-weight:700;' })}
            <div class="controls" style="justify-content: flex-end; margin-top: 20px; gap: 12px;">
                <button type="button" class="secondary" id="cancelQms">Cancel</button>
                <button type="submit" class="success">Submit</button>
            </div>
        </form>
    </div>`;

    document.getElementById('cancelQms').onclick = () => loadQmsList(container, currentUser, currentUserData);

    document.getElementById('qmsForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {};
        QMS_FIELDS.forEach(f => {
            const el = e.target.querySelector(`[name="${f.name}"]`);
            if (el) data[f.name] = el.value;
        });
        data.state = currentUserData?.state || '';
        data.zone = currentUserData?.zone || '';
        data.createdBy = currentUser.uid;
        data.createdByName = currentUserData?.displayName || currentUser.email;
        data.createdAt = serverTimestamp();

        try {
            await addDoc(collection(db, 'qmsLogs'), data);
            showToast('Logged', 'QMS activity saved.', 'success');
            loadQmsList(container, currentUser, currentUserData);
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };
}
