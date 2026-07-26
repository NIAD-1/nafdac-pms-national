import { db, collection, getDocs, query, where } from "./db.js";
import { getUserScope } from "./auth.js";
import { escapeHtml, showToast } from "./ui.js";
import { canUsePushNotifications, enablePhonePushNotifications, initForegroundPushHandler } from "./push.js";

let activeUser = null;
let activeUserData = null;
let refreshTimer = null;
let currentItems = [];
let pushSupported = false;

const READ_KEY_PREFIX = 'nafdacPmsReadNotifications';

function readKey() {
    return `${READ_KEY_PREFIX}:${activeUser?.uid || activeUserData?.email || 'guest'}`;
}

function getReadIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem(readKey()) || '[]'));
    } catch {
        return new Set();
    }
}

function saveReadIds(ids) {
    localStorage.setItem(readKey(), JSON.stringify([...ids].slice(-500)));
}

function markRead(ids) {
    const read = getReadIds();
    ids.forEach(id => read.add(id));
    saveReadIds(read);
    renderBell();
}

function scopedQuery(collectionName, scope, fieldOverride = '') {
    const stateField = fieldOverride || 'state';
    const zoneField = fieldOverride || 'zone';
    if (scope.state) return query(collection(db, collectionName), where(stateField, '==', scope.state));
    if (scope.zone) return query(collection(db, collectionName), where(zoneField, '==', scope.zone));
    return query(collection(db, collectionName));
}

async function fetchScopedRecords(collectionName, scope) {
    if (!scope.state && !scope.zone) {
        const snap = await getDocs(query(collection(db, collectionName)));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    if (scope.state) {
        const [assigned, origin] = await Promise.all([
            getDocs(query(collection(db, collectionName), where('state', '==', scope.state))),
            getDocs(query(collection(db, collectionName), where('originState', '==', scope.state)))
        ]);
        const byId = new Map();
        assigned.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));
        origin.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));
        return [...byId.values()];
    }

    const [assigned, origin] = await Promise.all([
        getDocs(scopedQuery(collectionName, scope)),
        getDocs(scopedQuery(collectionName, scope, 'originZone'))
    ]);
    const byId = new Map();
    assigned.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));
    origin.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));
    return [...byId.values()];
}

async function buildNotificationItems() {
    const scope = getUserScope();
    const items = [];

    const complaints = await fetchScopedRecords('complaints', scope);
    complaints.forEach(c => {
        const status = c.status || 'Open';
        const isActive = ['Open', 'Under Investigation', 'Worked On'].includes(status);
        const isOrigin = scope.state && c.originState === scope.state && c.state !== scope.state;

        if (isActive) {
            items.push({
                id: `complaint:${c.id}:${status}:${c.updatedAt?.seconds || c.createdAt?.seconds || 0}`,
                type: 'complaint',
                priority: status === 'Open' && !isOrigin ? 'high' : 'medium',
                title: isOrigin && status === 'Worked On' ? 'Submitted complaint worked on' : status === 'Worked On' ? 'Complaint response ready' : 'Complaint needs response',
                message: `${c.productName || 'Consumer complaint'} in ${c.state || 'your scope'} is ${status.toLowerCase()}.`,
                meta: c.dateLogged || '',
                targetPage: 'log-complaints',
                targetId: c.id
            });
        }
    });

    const alertsSnap = await getDocs(query(collection(db, 'alerts')));
    alertsSnap.docs.forEach(docSnap => {
        const a = { id: docSnap.id, itemType: 'product_alert', scope: 'nationwide', approvalStatus: 'approved', ...docSnap.data() };
        const applies = (!a.approvalStatus || a.approvalStatus === 'approved') && (
            (!scope.state && !scope.zone) ||
            a.scope === 'nationwide' ||
            (scope.state && a.state === scope.state) ||
            (scope.zone && a.zone === scope.zone) ||
            (scope.state && Array.isArray(a.targetStates) && a.targetStates.includes(scope.state))
        );
        if (!applies) return;
        const typeLabel = ({
            product_alert: 'Product alert',
            recall: 'Recall',
            advert_watch: 'Advert watch',
            rasff: 'RASFF notice'
        })[a.itemType] || 'Product alert';
        items.push({
            id: `alert:${a.id}:${a.createdAt?.seconds || a.dateIssued || ''}`,
            type: 'alert',
            priority: ['Critical', 'High'].includes(a.priority) ? 'high' : 'medium',
            title: `${typeLabel} active`,
            message: `${a.productName || 'Watchlist item'}: ${a.reason || 'Review field instructions.'}`,
            meta: a.dateIssued || a.alertRef || '',
            targetPage: 'alerts'
        });
    });

    return items.sort((a, b) => {
        const score = { high: 3, medium: 2, low: 1 };
        return (score[b.priority] || 0) - (score[a.priority] || 0);
    });
}

function renderBell() {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;

    const read = getReadIds();
    const unread = currentItems.filter(item => !read.has(item.id)).length;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
}

function renderPanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;

    const read = getReadIds();
    const unreadCount = currentItems.filter(item => !read.has(item.id)).length;

    panel.innerHTML = `
        <div class="notification-panel-header">
            <div>
                <h3>Action Alerts</h3>
                <p class="muted small">${unreadCount} unread task${unreadCount === 1 ? '' : 's'}</p>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                ${pushSupported ? `<button class="secondary" id="enablePhoneAlerts" style="padding:6px 10px; font-size:11px;">Phone Alerts</button>` : ''}
                <button class="secondary" id="markAllNotificationsRead" style="padding:6px 10px; font-size:11px;">Mark Read</button>
            </div>
        </div>
        <div class="notification-list">
            ${currentItems.length ? currentItems.map(item => `
                <button class="notification-item ${read.has(item.id) ? 'read' : 'unread'}" data-notification-id="${escapeHtml(item.id)}">
                    <span class="notification-dot ${item.priority}"></span>
                    <span>
                        <strong>${escapeHtml(item.title)}</strong>
                        <small>${escapeHtml(item.message)}</small>
                        ${item.meta ? `<em>${escapeHtml(item.meta)}</em>` : ''}
                    </span>
                </button>
            `).join('') : `
                <div class="notification-empty">
                    <strong>All clear</strong>
                    <span>No complaint or alert needs attention right now.</span>
                </div>
            `}
        </div>`;

    document.getElementById('markAllNotificationsRead')?.addEventListener('click', () => {
        markRead(currentItems.map(item => item.id));
        renderPanel();
    });

    document.getElementById('enablePhoneAlerts')?.addEventListener('click', async () => {
        const btn = document.getElementById('enablePhoneAlerts');
        btn.disabled = true;
        btn.textContent = 'Enabling...';
        try {
            await enablePhonePushNotifications(activeUserData);
            showToast('Phone Alerts Enabled', 'This device can now receive PMS alerts when supported by the phone/browser.', 'success', 6000);
        } catch (err) {
            showToast('Phone Alerts Not Enabled', err.message, 'warning', 8000);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Phone Alerts';
        }
    });

    panel.querySelectorAll('[data-notification-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = currentItems.find(x => x.id === btn.dataset.notificationId);
            if (!item) return;
            markRead([item.id]);
            panel.classList.add('hidden');
            if (item.targetId) sessionStorage.setItem('focusComplaintId', item.targetId);
            window.dispatchEvent(new CustomEvent('navigate', { detail: item.targetPage }));
        });
    });
}

export async function refreshNotificationBell({ silent = true } = {}) {
    if (!activeUser) return;

    try {
        currentItems = await buildNotificationItems();
        renderBell();
        const panel = document.getElementById('notificationPanel');
        if (panel && !panel.classList.contains('hidden')) renderPanel();
    } catch (err) {
        console.error('[Notifications] refresh failed:', err);
        if (!silent) showToast('Alerts Unavailable', err.message, 'warning');
    }
}

export function initNotificationCenter(user, userData) {
    activeUser = user;
    activeUserData = userData;

    const bell = document.getElementById('notificationBell');
    const panel = document.getElementById('notificationPanel');

    canUsePushNotifications().then(supported => {
        pushSupported = supported;
        if (supported) initForegroundPushHandler();
    });

    bell?.addEventListener('click', async (event) => {
        event.stopPropagation();
        await refreshNotificationBell({ silent: false });
        renderPanel();
        panel?.classList.toggle('hidden');
    });

    document.addEventListener('click', (event) => {
        if (!panel || panel.classList.contains('hidden')) return;
        if (!panel.contains(event.target) && event.target !== bell) panel.classList.add('hidden');
    });

    clearInterval(refreshTimer);
    refreshNotificationBell();
    refreshTimer = setInterval(() => refreshNotificationBell(), 60000);
}
