/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — TEAM MANAGEMENT (MANAGE TEAM)
 * ═══════════════════════════════════════════════════════════════
 */
import { db, doc, collection, getDocs, setDoc, serverTimestamp, query, where } from "./db.js";
import { clearRoot, showLoading, showToast } from "./ui.js";
import { ROLES, ZONES, ALL_STATES, getZoneForState } from "./constants.js";
import { logAuditAction } from "./audit.js";

export async function loadTeamPage(root, user, userData) {
    showLoading(root, 'Loading Team Roster...');
    
    // Determine access constraints based on user's role level
    const userLevel = ROLES[userData.role]?.level || 1;
    if (userLevel < 2) {
        root.innerHTML = `<div class="card"><p class="muted">Access Denied. You do not have permission to manage teams.</p></div>`;
        return;
    }

    try {
        let q;
        if (userLevel >= 4) {
            // Admin sees all users including pending ones
            q = query(collection(db, "users"));
        } else if (userLevel === 3) {
            // Zonal Coordinator sees their zone (and maybe pending users depending on business rules, but since pending has no zone, Admin must assign first unless we show pending to all coords - we will show users with matching zone or no zone)
            // Firebase limits OR queries, so we just get all and filter locally for simplicity if needed, but for now we'll do 2 queries or just rely on Admin to map them.
            // Let's do all users, then filter in JS to support "pending" users.
            q = query(collection(db, "users"));
        } else if (userLevel === 2) {
            q = query(collection(db, "users"));
        }

        const snap = await getDocs(q);
        let users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Filter based on role logic:
        if (userLevel === 3) {
            users = users.filter(u => u.zone === userData.zone || u.role === 'pending');
        } else if (userLevel === 2) {
            users = users.filter(u => u.state === userData.state || u.role === 'pending');
        }

        renderTeamPage(root, userData, userLevel, users);
    } catch (err) {
        console.error("Team load error:", err);
        root.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`;
    }
}

function renderTeamPage(root, userData, userLevel, users) {
    clearRoot(root);

    // Filter available roles to assign based on the current user's level
    let roleOptionsHTML = '';
    Object.keys(ROLES).forEach(r => {
        const rLevel = ROLES[r].level;
        if (r !== 'national_admin' && rLevel <= userLevel && !(rLevel === userLevel && rLevel < 4)) {
            roleOptionsHTML += `<option value="${r}">${ROLES[r].label}</option>`;
        }
    });

    const isZoneLocked = userLevel <= 3;
    const isStateLocked = userLevel <= 2;

    const zoneOptionsHTML = Object.keys(ZONES).map(z => `<option value="${z}">${z}</option>`).join('');
    const stateOptionsHTML = ALL_STATES.map(s => `<option value="${s}">${s}</option>`).join('');

    const userOptionsHTML = users.map(u => `<option value="${u.id}">${u.displayName || u.email} (${u.role === 'pending' ? 'Pending Approval' : ROLES[u.role]?.label || u.role})</option>`).join('');

    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 1000px; margin: 0 auto;">
        <h1 style="margin-bottom: 8px;">🤝 Manage Team Directory</h1>
        <p class="muted" style="margin-bottom: 32px;">Approve new users and assign their roles and operational jurisdiction.</p>

        <div style="display:flex; gap:24px; flex-wrap:wrap; align-items:flex-start;">
            
            <!-- ASSIGN ACCESS FORM -->
            <div class="card" style="flex:1; min-width:300px; position:sticky; top:20px;">
                <h3 style="margin-bottom:20px;">Assign Officer Access</h3>
                <form id="assignUserForm" style="display:flex; flex-direction:column; gap:16px;">
                    <div>
                        <label>Select Officer <span style="color:var(--danger);">*</span></label>
                        <select id="tUserId" required>
                            <option value="">Choose a user...</option>
                            ${userOptionsHTML}
                        </select>
                        <div class="input-hint">List includes all users who have signed into the portal.</div>
                    </div>
                    <div>
                        <label>Role</label>
                        <select id="tRole" required>
                            <option value="">Select Role...</option>
                            ${roleOptionsHTML}
                        </select>
                    </div>
                    <div id="zoneDiv" ${isZoneLocked ? 'style="display:none;"' : ''}>
                        <label>Zone</label>
                        <select id="tZone">
                            <option value="">Select Zone...</option>
                            ${zoneOptionsHTML}
                        </select>
                    </div>
                    <div id="stateDiv" ${isStateLocked ? 'style="display:none;"' : ''}>
                        <label>State</label>
                        <select id="tState">
                            <option value="">Select State...</option>
                            ${stateOptionsHTML}
                        </select>
                    </div>
                    
                    <!-- STATUS: ONLY FOR ADMINS (Level 4) -->
                    <div id="statusDiv" ${userLevel < 4 ? 'style="display:none;"' : ''}>
                        <label>Approval Status <span class="badge badge-red">Admin Only</span></label>
                        <select id="tStatus">
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                        </select>
                    </div>
                    
                    <button type="submit" class="primary" style="margin-top:10px;">Update Access</button>
                </form>
            </div>

            <!-- DIRECTORY DIRECTORY -->
            <div class="card" style="flex:2; min-width:400px; padding:0; overflow:hidden;">
                <div style="padding:20px; border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0;">Active Personnel Directory</h3>
                    <span class="badge badge-blue">${users.length} Officers</span>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%; text-align:left; border-collapse:collapse;">
                        <thead>
                            <tr style="background:var(--bg-secondary);">
                                <th style="padding:12px 20px;">Name & Email</th>
                                <th style="padding:12px 20px;">Role</th>
                                <th style="padding:12px 20px;">Location</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(u => `
                                <tr style="border-bottom:1px solid var(--border-subtle);">
                                    <td style="padding:16px 20px;">
                                        <strong>${u.displayName || u.email || '—'}</strong><br>
                                        <span class="muted small">${u.email}</span>
                                    </td>
                                    <td style="padding:16px 20px;">
                                        ${u.role === 'pending' ? `<span class="badge" style="background:#fff3cd; color:#856404; border:1px solid #ffeeba;">Pending Approval</span>` : `<span class="badge" style="background:var(--bg-hover); color:var(--text-primary); border:1px solid var(--border-subtle);">${ROLES[u.role]?.label || u.role}</span>`}
                                    </td>
                                    <td style="padding:16px 20px; color:${u.zone ? '' : 'var(--text-muted)'};">
                                        ${u.state ? `${u.state} State` : (u.zone ? `${u.zone} Zone` : (u.role === 'pending' ? 'Unassigned' : 'National Hq'))}
                                    </td>
                                </tr>
                            `).join('') || '<tr><td colspan="3" style="text-align:center; padding:30px;" class="muted">No users found.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    </div>`;

    const form = document.getElementById('assignUserForm');
    const userSelect = document.getElementById('tUserId');
    const roleSelect = document.getElementById('tRole');
    const stateSelect = document.getElementById('tState');
    const zoneSelect = document.getElementById('tZone');
    const stateDiv = document.getElementById('stateDiv');
    const zoneDiv = document.getElementById('zoneDiv');

    // Populate form if a user is selected
    userSelect.addEventListener('change', (e) => {
        const uid = e.target.value;
        const u = users.find(x => x.id === uid);
        if (u) {
            roleSelect.value = u.role !== 'pending' ? u.role : '';
            updateJurisdictionVisibility(roleSelect.value);
            
            if (!isZoneLocked) zoneSelect.value = u.zone || '';
            if (!isStateLocked) stateSelect.value = u.state || '';
            if (userLevel >= 4) document.getElementById('tStatus').value = u.status || 'pending';
        }
    });

    // Handle Role Change -> Show/Hide Jurisdictions
    roleSelect.addEventListener('change', (e) => {
        updateJurisdictionVisibility(e.target.value);
    });

    function updateJurisdictionVisibility(role) {
        if (!role) {
            stateDiv.style.display = 'none';
            zoneDiv.style.display = 'none';
            return;
        }

        const rLevel = ROLES[role]?.level || 1;
        
        // Field Officer (1) or State Coordinator (2) -> Show State
        if (rLevel === 1 || rLevel === 2) {
            stateDiv.style.display = isStateLocked ? 'none' : 'block';
            zoneDiv.style.display = isZoneLocked ? 'none' : 'block';
        } 
        // Zonal Coordinator (3) -> Show Zone (Hide State)
        else if (rLevel === 3) {
            stateDiv.style.display = 'none';
            zoneDiv.style.display = isZoneLocked ? 'none' : 'block';
        }
        // National Admin / Admin (4) -> Hide both
        else {
            stateDiv.style.display = 'none';
            zoneDiv.style.display = 'none';
        }
    }

    if (!isStateLocked) {
        stateSelect.addEventListener('change', (e) => {
            const z = getZoneForState(e.target.value);
            if (z && !isZoneLocked) zoneSelect.value = z;
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const uid = userSelect.value;
        const role = roleSelect.value;
        const rLevel = ROLES[role]?.level || 1;
        
        let state = isStateLocked ? userData.state : stateSelect.value;
        let zone = isZoneLocked ? userData.zone : zoneSelect.value;

        // --- STRICT VALIDATION ---
        if (rLevel === 2 && !state) {
            showToast('Validation Error', 'State Coordinator MUST have a State assigned.', 'error');
            return;
        }
        if (rLevel === 3 && !zone) {
            showToast('Validation Error', 'Zonal Coordinator MUST have a Zone assigned.', 'error');
            return;
        }
        if (rLevel === 1 && !state) {
            showToast('Validation Error', 'Field Officer MUST have a State assigned.', 'error');
            return;
        }

        // Ensure state implies zone automatically
        if (state && !zone) {
            zone = getZoneForState(state) || '';
        }

        try {
            const btn = form.querySelector('button');
            const originalText = btn.textContent;
            btn.textContent = 'Updating...';
            btn.disabled = true;

            const updatePayload = {
                role: role,
                state: state,
                zone: zone,
                updatedBy: userData.uid || userData.email,
                updatedAt: serverTimestamp()
            };

            // Only Admins can change status
            if (userLevel >= 4) {
                updatePayload.status = document.getElementById('tStatus').value;
            }

            await setDoc(doc(db, "users", uid), updatePayload, { merge: true });

            // Fire silent audit log
            await logAuditAction(
                'USER_ACCESS_UPDATED',
                'users',
                uid,
                { newRole: role, newState: state, newZone: zone },
                userData
            );
            
            showToast('Success', `Access updated for ${role}.`, 'success');
            setTimeout(() => {
                loadTeamPage(root, null, userData); // Refresh
            }, 1000);

        } catch (err) {
            console.error(err);
            showToast('Error', err.message, 'error');
            const btn = form.querySelector('button');
            btn.textContent = 'Update Access';
            btn.disabled = false;
        }
    });
}
