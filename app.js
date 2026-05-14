/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v4 — APPLICATION SHELL & ROUTER
 * Email/Password auth with forced password change on first login.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, getDocs, query, where, Timestamp, prefetchStateRegistry } from "./db.js";
import { initAuth, signInWithEmail, sendPasswordReset, changeUserPassword, logOut, applyRoleNav, canAccessPage, getUserScope } from "./auth.js";
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

document.getElementById('btnSignOut').onclick = logOut;

// ── LOGIN FORM HANDLER ──────────────────────────────────────────
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errorDiv = document.getElementById('loginError');
        const btn = document.getElementById('btnSignIn');

        errorDiv.style.display = 'none';
        btn.textContent = 'Signing in...';
        btn.disabled = true;

        try {
            await signInWithEmail(email, password);
            // Auth state change will handle the rest
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.style.display = 'block';
        }

        btn.textContent = 'Sign In';
        btn.disabled = false;
    });
}

// ── FORGOT PASSWORD HANDLER ─────────────────────────────────────
document.getElementById('btnForgotPassword')?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail')?.value?.trim();
    if (!email) {
        showToast('Enter Email', 'Please type your email address in the field above, then click Forgot Password.', 'warning', 5000);
        return;
    }
    try {
        await sendPasswordReset(email);
        showToast('Email Sent', `A password reset link has been sent to ${email}. Check your inbox.`, 'success', 6000);
    } catch (err) {
        showToast('Error', err.message, 'error');
    }
});

// ── PASSWORD CHANGE FORM HANDLER ────────────────────────────────
const pwChangeForm = document.getElementById('passwordChangeForm');
if (pwChangeForm) {
    pwChangeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPw = document.getElementById('newPassword').value;
        const confirmPw = document.getElementById('confirmPassword').value;
        const errorDiv = document.getElementById('pwChangeError');
        const btn = pwChangeForm.querySelector('button[type="submit"]');

        errorDiv.style.display = 'none';

        if (newPw !== confirmPw) {
            errorDiv.textContent = 'Passwords do not match. Please try again.';
            errorDiv.style.display = 'block';
            return;
        }
        if (newPw.length < 8) {
            errorDiv.textContent = 'Password must be at least 8 characters.';
            errorDiv.style.display = 'block';
            return;
        }

        btn.textContent = 'Setting password...';
        btn.disabled = true;

        try {
            await changeUserPassword(newPw);
            showToast('Password Set!', 'Your new password has been saved. Loading the portal...', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.style.display = 'block';
            btn.textContent = '🔒 Set Password & Continue';
            btn.disabled = false;
        }
    });
}

document.getElementById('btnPwChangeSignOut')?.addEventListener('click', logOut);

// ── Mobile Sidebar Toggle ───────────────────────────────────────
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

// ── SCREEN MANAGEMENT ───────────────────────────────────────────
const passwordChangeScreen = document.getElementById('passwordChangeScreen');

function showScreen(screen) {
    loginScreen.style.display = 'none';
    authenticatedApp.style.display = 'none';
    if (passwordChangeScreen) passwordChangeScreen.style.display = 'none';
    loginScreen.classList.add('hidden');
    authenticatedApp.classList.add('hidden');

    if (screen === 'login') {
        loginScreen.style.display = 'flex';
        loginScreen.classList.remove('hidden');
    } else if (screen === 'password-change') {
        if (passwordChangeScreen) passwordChangeScreen.style.display = 'flex';
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

        // Check if this is an unauthorized email (not provisioned by admin)
        if (userData.role === 'unauthorized' || userData.status === 'unauthorized') {
            showToast('Access Denied', 'Your email is not registered in the system. Contact your administrator.', 'error', 6000);
            logOut();
            return;
        }

        const isAdmin = ['admin', 'national_admin'].includes(userData.role);
        const isApproved = userData.status === 'approved';

        if (isAdmin || isApproved) {
            // Check if they need to change their password first
            if (userData.mustChangePassword) {
                showScreen('password-change');
                const pwName = document.getElementById('pwChangeUserName');
                if (pwName) pwName.textContent = userData.displayName || user.email;
                return;
            }

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
            // ⛔ Not approved — deny access
            showToast('Access Pending', 'Your account has not been approved yet. Contact your administrator.', 'warning', 5000);
            logOut();
        }
    } else {
        currentUser = null;
        currentUserData = null;
        showScreen('login');
        clearRoot(root);
    }
});
