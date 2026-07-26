import { changeUserPassword } from "./auth.js";
import { ROLES } from "./constants.js";
import { clearRoot, escapeHtml, showToast } from "./ui.js";

export async function loadProfilePage(root, currentUser, currentUserData) {
    clearRoot(root);

    const roleLabel = ROLES[currentUserData?.role]?.label || currentUserData?.role || 'Officer';
    const scopeLabel = currentUserData?.state
        ? `${currentUserData.state} State`
        : currentUserData?.zone
            ? `${currentUserData.zone} Zone`
            : 'National Headquarters';

    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 920px; margin: 0 auto;">
        <div style="margin-bottom:20px;">
            <h1 style="margin-bottom:4px;">👤 My Profile</h1>
            <p class="muted small">Your posting, access level, and account security.</p>
        </div>

        <div class="profile-grid">
            <section class="card profile-identity">
                <div class="profile-avatar">${escapeHtml((currentUserData?.displayName || currentUser?.email || 'O').slice(0, 1).toUpperCase())}</div>
                <h2>${escapeHtml(currentUserData?.displayName || currentUser?.email || 'Officer')}</h2>
                <p class="muted small">${escapeHtml(currentUser?.email || currentUserData?.email || '')}</p>
                <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:16px;">
                    <span class="badge badge-green">${escapeHtml(roleLabel)}</span>
                    <span class="badge badge-blue">${escapeHtml(scopeLabel)}</span>
                </div>
            </section>

            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 style="margin-bottom:4px;">Posting Details</h2>
                        <p class="muted small">These assignments are managed by administrators.</p>
                    </div>
                </div>
                <div class="profile-detail-list">
                    <div><span>Zone</span><strong>${escapeHtml(currentUserData?.zone || 'National')}</strong></div>
                    <div><span>State</span><strong>${escapeHtml(currentUserData?.state || 'All States')}</strong></div>
                    <div><span>Role</span><strong>${escapeHtml(roleLabel)}</strong></div>
                    <div><span>Status</span><strong>${escapeHtml(currentUserData?.status || 'approved')}</strong></div>
                </div>
            </section>
        </div>

        <section class="card">
            <div class="card-header">
                <div>
                    <h2 style="margin-bottom:4px;">Change Password</h2>
                    <p class="muted small">Use your current password before setting a new one.</p>
                </div>
            </div>
            <form id="profilePasswordForm" class="profile-password-form">
                <div class="form-row">
                    <div class="form-group">
                        <label>Current Password</label>
                        <input type="password" name="currentPassword" required autocomplete="current-password">
                    </div>
                    <div class="form-group">
                        <label>New Password</label>
                        <input type="password" name="newPassword" required minlength="8" autocomplete="new-password">
                    </div>
                </div>
                <div class="form-group">
                    <label>Confirm New Password</label>
                    <input type="password" name="confirmPassword" required minlength="8" autocomplete="new-password">
                </div>
                <div class="controls" style="justify-content:flex-end;">
                    <button type="submit" class="success">Update Password</button>
                </div>
            </form>
        </section>
    </div>`;

    document.getElementById('profilePasswordForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const currentPassword = form.currentPassword.value;
        const newPassword = form.newPassword.value;
        const confirmPassword = form.confirmPassword.value;
        const btn = form.querySelector('button[type="submit"]');

        if (newPassword !== confirmPassword) {
            showToast('Password Mismatch', 'The new passwords do not match.', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Updating...';
        try {
            await changeUserPassword(newPassword, currentPassword);
            form.reset();
            showToast('Password Updated', 'Your password has been changed successfully.', 'success');
        } catch (err) {
            const message = err.code === 'auth/invalid-credential'
                ? 'Your current password is incorrect.'
                : err.message;
            showToast('Password Not Changed', message, 'error', 6000);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Update Password';
        }
    });
}
