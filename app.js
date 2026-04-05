/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — APPLICATION SHELL & ROUTER
 * Multi-page routing with role-gating and daily escalation.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, getDocs, query, where, Timestamp, prefetchStateRegistry } from "./db.js";
import { initAuth, signInWithGoogle, logOut, applyRoleNav, canAccessPage, getUserScope } from "./auth.js";
import { clearRoot, showToast, showLoading } from "./ui.js";
import { initWizard, startReportWizard } from "./wizard.js";
import { loadDashboard } from "./dashboard.js";
import { loadFacilitiesPage } from "./facilities.js";
import { loadComplaintsPage } from "./complaints.js";
import { loadAdvertsPage } from "./adverts-log.js";
import { loadRasffPage } from "./rasff-log.js";
import { loadMeetingsPage } from "./meetings-qms.js";
import { loadRevenuePage } from "./revenue.js";
import { loadAlertsPage } from "./alerts.js";
import { loadTeamPage } from "./team.js";
import { ZONES, ALL_STATES, DAILY_ACTIVITIES, getZoneForState, formatCurrency, getCurrentMonth, getCurrentYear, getMonthName } from "./constants.js";

const root = document.getElementById('app');
const loginScreen = document.getElementById('loginScreen');
const authenticatedApp = document.getElementById('authenticatedApp');
const userNameDisplay = document.getElementById('userName');

let currentUser = null;
let currentUserData = null;

// ── Page Navigation ─────────────────────────────────────────────
async function navigate(page) {
    if (!currentUser || !currentUserData) return;

    // Check role access
    if (!canAccessPage(currentUserData.role, page)) {
        showToast('Access Denied', 'You do not have permission to view this page.', 'warning');
        navigate('home');
        return;
    }

    // Update active nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === page);
    });

    // Auto-close mobile sidebar
    const _sidebar = document.getElementById('sidebar');
    const _overlay = document.getElementById('sidebarOverlay');
    if (_sidebar) _sidebar.classList.remove('open');
    if (_overlay) _overlay.classList.remove('active');

    switch (page) {
        case 'home':
            await renderHomePage();
            break;
        case 'activity':
            await startReportWizard(root);
            break;
        case 'facilities':
            await loadFacilitiesPage(root, currentUser, currentUserData);
            break;
        case 'revenue':
            await loadRevenuePage(root, currentUser, currentUserData);
            break;
        case 'dashboard':
            await loadDashboard(root, db, currentUser, currentUserData);
            break;
        case 'team':
            await loadTeamPage(root, currentUser, currentUserData);
            break;
        case 'compliance':
            await renderCompliancePage();
            break;
        case 'log-complaints':
            await loadComplaintsPage(root, currentUser, currentUserData);
            break;
        case 'log-adverts':
            await loadAdvertsPage(root, currentUser, currentUserData);
            break;
        case 'log-meetings':
            await loadMeetingsPage(root, currentUser, currentUserData);
            break;
        case 'log-rasff':
            await loadRasffPage(root, currentUser, currentUserData);
            break;
        case 'alerts':
            await loadAlertsPage(root, currentUser, currentUserData);
            break;
        default:
            await renderHomePage();
    }
}

// ── HOME PAGE ───────────────────────────────────────────────────
async function renderHomePage() {
    showLoading(root, 'Loading...');
    const scope = getUserScope();

    // Get today's reports
    const today = new Date().toISOString().split('T')[0];
    let todayCount = 0;
    let monthCount = 0;

    try {
        let q;
        if (scope.state) {
            q = query(collection(db, 'facilityReports'), where('state', '==', scope.state));
        } else if (scope.zone) {
            q = query(collection(db, 'facilityReports'), where('zone', '==', scope.zone));
        } else {
            q = query(collection(db, 'facilityReports'));
        }
        const snap = await getDocs(q);
        const reports = snap.docs.map(d => d.data());
        todayCount = reports.filter(r => r.inspectionDate === today).length;
        monthCount = reports.filter(r => r.month === getCurrentMonth() && r.year === getCurrentYear()).length;
    } catch (e) { console.error(e); }

    // Check non-reporting states (Director only)
    let escalationHtml = '';
    if ((currentUserData.role === 'national_admin' || currentUserData.role === 'admin') && !scope.state) {
        try {
            const monthReports = await getDocs(query(collection(db, 'facilityReports'),
                where('year', '==', getCurrentYear()),
                where('month', '==', getCurrentMonth())
            ));
            const reportingStates = new Set(monthReports.docs.map(d => d.data().state).filter(Boolean));
            const nonReporting = ALL_STATES.filter(s => !reportingStates.has(s));
            if (nonReporting.length > 0) {
                escalationHtml = `
                    <div class="card" style="border-left: 4px solid var(--danger); margin-bottom: 20px;">
                        <h3 style="color: var(--danger); margin-bottom: 8px;">🚨 Escalation Alert — ${nonReporting.length} States Not Reporting</h3>
                        <p class="muted small" style="margin-bottom: 12px;">The following states have <strong>zero submissions</strong> for ${getMonthName(getCurrentMonth())} ${getCurrentYear()}:</p>
                        <div style="display:flex; flex-wrap:wrap; gap:6px;">
                            ${nonReporting.map(s => `<span class="badge badge-red">${s}</span>`).join('')}
                        </div>
                    </div>`;
            }
        } catch (e) { console.error(e); }
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in">
        <h1 style="font-size: 28px; margin-bottom: 4px;">Good ${greeting} 👋</h1>
        <p class="muted" style="margin-bottom: 24px;">Welcome to the NAFDAC PMS National Intelligence Portal</p>

        ${escalationHtml}

        <div class="stat-cards">
            <div class="stat-card">
                <div class="stat-card-icon">📋</div>
                <div class="stat-card-title">Today's Entries</div>
                <div class="stat-card-value">${todayCount}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-icon">📊</div>
                <div class="stat-card-title">This Month</div>
                <div class="stat-card-value">${monthCount}</div>
            </div>
        </div>

        <!-- Quick Actions -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 24px;">
            <div class="card" style="cursor:pointer; text-align:center; padding: 28px;" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'activity' }))">
                <div style="font-size:36px; margin-bottom:8px;">📋</div>
                <h3 style="font-size:14px;">Daily Activity</h3>
                <p class="muted small">Submit field report</p>
            </div>
            <div class="card" style="cursor:pointer; text-align:center; padding: 28px;" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'facilities' }))">
                <div style="font-size:36px; margin-bottom:8px;">🏢</div>
                <h3 style="font-size:14px;">Facilities</h3>
                <p class="muted small">Directory & history</p>
            </div>
            <div class="card" style="cursor:pointer; text-align:center; padding: 28px;" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'log-complaints' }))">
                <div style="font-size:36px; margin-bottom:8px;">📝</div>
                <h3 style="font-size:14px;">Log Complaints</h3>
                <p class="muted small">Consumer complaints</p>
            </div>
            <div class="card" style="cursor:pointer; text-align:center; padding: 28px;" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'revenue' }))">
                <div style="font-size:36px; margin-bottom:8px;">💰</div>
                <h3 style="font-size:14px;">Revenue</h3>
                <p class="muted small">Payments & sanctions</p>
            </div>
            ${canAccessPage(currentUserData.role, 'dashboard') ? `
            <div class="card" style="cursor:pointer; text-align:center; padding: 28px;" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'dashboard' }))">
                <div style="font-size:36px; margin-bottom:8px;">📊</div>
                <h3 style="font-size:14px;">Dashboard</h3>
                <p class="muted small">Analytics & insights</p>
            </div>` : ''}
            ${canAccessPage(currentUserData.role, 'alerts') ? `
            <div class="card" style="cursor:pointer; text-align:center; padding: 28px;" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'alerts' }))">
                <div style="font-size:36px; margin-bottom:8px;">🚨</div>
                <h3 style="font-size:14px;">Alerts</h3>
                <p class="muted small">Product alerts intel</p>
            </div>` : ''}
        </div>
    </div>`;
}




// ── COMPLIANCE HEATMAP PAGE ─────────────────────────────────────
async function renderCompliancePage() {
    showLoading(root, 'Loading compliance data...');

    try {
        const reports = await getDocs(query(collection(db, 'facilityReports'),
            where('year', '==', getCurrentYear()),
            where('month', '==', getCurrentMonth())
        ));
        const stateCounts = {};
        ALL_STATES.forEach(s => stateCounts[s] = 0);
        reports.docs.forEach(d => {
            const state = d.data().state;
            if (state) stateCounts[state] = (stateCounts[state] || 0) + 1;
        });

        const maxCount = Math.max(...Object.values(stateCounts), 1);
        clearRoot(root);
        root.innerHTML = `
        <div class="animate-fade-in">
            <h1 style="margin-bottom:4px;">🗺️ State Compliance Heatmap</h1>
            <p class="muted small" style="margin-bottom:20px;">${getMonthName(getCurrentMonth())} ${getCurrentYear()} — Submissions by state</p>

            <div class="card" style="margin-bottom: 16px;">
                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                    <span class="badge badge-green">● Active (5+ entries)</span>
                    <span class="badge badge-yellow">● Moderate (1–4 entries)</span>
                    <span class="badge badge-red">● Inactive (0 entries)</span>
                </div>
            </div>

            ${Object.entries(ZONES).map(([zone, states]) => `
                <div class="card" style="margin-bottom: 12px;">
                    <h3 style="margin-bottom: 12px;">${zone}</h3>
                    <div class="heatmap-grid">
                        ${states.map(s => {
                            const count = stateCounts[s] || 0;
                            const cls = count >= 5 ? 'heatmap-green' : count >= 1 ? 'heatmap-yellow' : 'heatmap-red';
                            return `
                            <div class="heatmap-cell ${cls}">
                                <div class="state-name">${s}</div>
                                <div class="state-count">${count}</div>
                                <div class="state-pct">${count === 1 ? '1 entry' : `${count} entries`}</div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            `).join('')}
        </div>`;
    } catch (err) {
        console.error("Compliance error:", err);
        root.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

// ── EVENT LISTENERS ─────────────────────────────────────────────
window.addEventListener('navigate', (e) => navigate(e.detail));

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = (e) => navigate(e.target.dataset.target || e.target.closest('.nav-btn').dataset.target);
});

document.getElementById('btnSignIn').onclick = signInWithGoogle;
document.getElementById('btnSignOut').onclick = logOut;

// Mobile Sidebar Toggle
const sidebar = document.getElementById('sidebar');
const toggle = document.getElementById('sidebarToggle');
const overlay = document.getElementById('sidebarOverlay');

function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

if (toggle && sidebar) {
    toggle.onclick = () => {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
    };
}
if (overlay) {
    overlay.onclick = closeSidebar;
}

// Screen references
const waitingRoom = document.getElementById('waitingRoom');

function showScreen(screen) {
    loginScreen.style.display = 'none';
    authenticatedApp.style.display = 'none';
    waitingRoom.style.display = 'none';
    loginScreen.classList.add('hidden');
    authenticatedApp.classList.add('hidden');

    if (screen === 'login') {
        loginScreen.style.display = 'flex';
        loginScreen.classList.remove('hidden');
    } else if (screen === 'waiting') {
        waitingRoom.style.display = 'flex';
    } else if (screen === 'app') {
        authenticatedApp.style.display = 'flex';
        authenticatedApp.classList.remove('hidden');
    }
}

// ── AUTH LIFECYCLE ──────────────────────────────────────────────
initAuth(db, (user, userData) => {
    if (user && userData) {
        currentUser = user;
        currentUserData = userData;

        const isAdmin = ['admin', 'national_admin'].includes(userData.role);
        const isApproved = userData.status === 'approved';

        if (isAdmin || isApproved) {
            // ✅ Full access — show the app
            showScreen('app');
            userNameDisplay.textContent = userData.displayName || user.email;
            applyRoleNav(userData.role);

            if (userData.state) {
                prefetchStateRegistry(userData.state);
            }

            initWizard(user, userData);
            navigate('home');
            showToast('Welcome Back', `Signed in as ${userData.displayName || user.email}`, 'success', 3000);
        } else {
            // ⏳ Pending — show waiting room
            showScreen('waiting');
            const waitingName = document.getElementById('waitingUserName');
            if (waitingName) waitingName.textContent = userData.displayName || user.email;
        }
    } else {
        currentUser = null;
        currentUserData = null;
        showScreen('login');
        clearRoot(root);
    }
});

// ── Waiting Room: "Check Again" Button ──────────────────────────
document.getElementById('btnCheckAgain')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnCheckAgain');
    btn.textContent = '⏳ Checking...';
    btn.disabled = true;

    try {
        // Re-read the user's Firestore doc to check for approval
        const { getDoc, doc } = await import("./db.js");
        const userRef = doc(db, "users", currentUser.uid);
        const freshDoc = await getDoc(userRef);
        
        if (freshDoc.exists()) {
            const freshData = freshDoc.data();
            if (freshData.status === 'approved' || ['admin', 'national_admin'].includes(freshData.role)) {
                // 🎉 Approved! Reload the page to trigger full auth lifecycle
                showToast('Access Granted!', 'Your account has been approved. Loading the portal...', 'success');
                setTimeout(() => window.location.reload(), 1500);
                return;
            }
        }
        
        showToast('Still Pending', 'Your access has not been approved yet. Please wait for the Admin.', 'warning', 4000);
    } catch (err) {
        console.error("Check again error:", err);
        showToast('Error', 'Could not check status. Please try again.', 'error');
    }

    btn.textContent = '🔄 Check Again';
    btn.disabled = false;
});

// ── Waiting Room: Sign Out ──────────────────────────────────────
document.getElementById('btnWaitingSignOut')?.addEventListener('click', logOut);
