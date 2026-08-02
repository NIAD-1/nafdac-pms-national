/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v4 — TEAM MANAGEMENT (MANAGE TEAM)
 * Admin-provisioned accounts with email/password auth.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, doc, collection, getDocs, setDoc, serverTimestamp, query } from "./db.js";
import { clearRoot, showLoading, showToast, escapeHtml } from "./ui.js";
import { ROLES, ZONES, ALL_STATES, getZoneForState } from "./constants.js";
import { notifyUserApproved, createOfficerAccount } from "./auth.js";
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
    
    let allowedStates = ALL_STATES;
    if (userLevel === 3 && userData.zone) {
        allowedStates = ZONES[userData.zone] || ALL_STATES;
    }
    const stateOptionsHTML = allowedStates.map(s => `<option value="${s}">${s}</option>`).join('');

    const userOptionsHTML = users.map(u => `<option value="${u.id}">${u.displayName || u.email} (${u.role === 'pending' ? 'Pending Approval' : ROLES[u.role]?.label || u.role})</option>`).join('');

    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 1100px; margin: 0 auto;">
        <h1 style="margin-bottom: 8px;">🤝 Manage Team Directory</h1>
        <p class="muted" style="margin-bottom: 32px;">Create officer accounts, assign roles, and manage operational jurisdictions.</p>

        ${userLevel >= 4 ? `
        <!-- ═══ CREATE NEW OFFICER (ADMIN ONLY) ═══ -->
        <div class="card" style="margin-bottom:24px; border-left:4px solid #008751;">
            <h3 style="margin-bottom:4px;">➕ Create New Officer Account</h3>
            <p class="muted small" style="margin-bottom:20px;">Provision a new account with a temporary password. The officer will be required to change it on first login.</p>
            <form id="createOfficerForm" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                <div>
                    <label>Officer's Full Name <span style="color:var(--danger);">*</span></label>
                    <input type="text" id="newOfficerName" placeholder="e.g. John Doe" required style="width:100%;">
                </div>
                <div>
                    <label>Email Address <span style="color:var(--danger);">*</span></label>
                    <input type="email" id="newOfficerEmail" placeholder="name@nafdac.gov.ng" required style="width:100%;">
                </div>
                <div>
                    <label>Temporary Password <span style="color:var(--danger);">*</span></label>
                    <input type="text" id="newOfficerPassword" placeholder="Min 8 chars" required minlength="8" style="width:100%;">
                    <div class="input-hint">Officer must change this on first login.</div>
                </div>
                <div>
                    <label>Role <span style="color:var(--danger);">*</span></label>
                    <select id="newOfficerRole" required style="width:100%;">
                        <option value="">Select Role...</option>
                        ${roleOptionsHTML}
                    </select>
                </div>
                <div>
                    <label>Zone</label>
                    <select id="newOfficerZone" style="width:100%;">
                        <option value="">Select Zone...</option>
                        ${zoneOptionsHTML}
                    </select>
                </div>
                <div>
                    <label>State</label>
                    <select id="newOfficerState" style="width:100%;">
                        <option value="">Select State...</option>
                        ${stateOptionsHTML}
                    </select>
                </div>
                <div style="grid-column: 1 / -1;">
                    <button type="submit" class="primary" style="width:100;">🔑 Create Account & Notify Officer</button>
                </div>
            </form>

            <!-- BULK CSV UPLOAD -->
            <div style="margin-top:24px; padding-top:20px; border-top:2px dashed var(--border-subtle);">
                <h4 style="margin-bottom:4px;">📁 Bulk Upload via CSV</h4>
                <p class="muted small" style="margin-bottom:12px;">Upload a CSV file with columns: <code>Name, Email, Password, Role, State, Zone</code></p>
                <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                    <input type="file" id="csvUpload" accept=".csv" style="font-size:13px;">
                    <button id="btnBulkUpload" class="secondary" style="padding:8px 20px;">🚀 Upload & Create All</button>
                </div>
                <div id="bulkProgress" style="margin-top:12px; display:none;">
                    <div style="background:var(--bg-secondary); border-radius:8px; height:8px; overflow:hidden; margin-bottom:8px;">
                        <div id="bulkProgressBar" style="height:100%; background:var(--nafdac-green); width:0%; transition:width 0.3s;"></div>
                    </div>
                    <p id="bulkStatus" class="muted small"></p>
                </div>
            </div>
        </div>
        ` : ''}

        <div style="display:flex; gap:24px; flex-wrap:wrap; align-items:flex-start;">
            
            <!-- ASSIGN ACCESS FORM -->
            <div class="card" style="flex:1; min-width:300px; position:sticky; top:20px;">
                <h3 style="margin-bottom:20px;">Modify Officer Access</h3>
                <form id="assignUserForm" style="display:flex; flex-direction:column; gap:16px;">
                    <div>
                        <label>Select Officer <span style="color:var(--danger);">*</span></label>
                        <select id="tUserId" required>
                            <option value="">Choose a user...</option>
                            ${userOptionsHTML}
                        </select>
                        <div class="input-hint">Select an existing officer to modify their access.</div>
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

            <!-- PERSONNEL DIRECTORY -->
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
                                        <strong>${escapeHtml(u.displayName || u.email || '—')}</strong><br>
                                        <span class="muted small">${escapeHtml(u.email)}</span>
                                    </td>
                                    <td style="padding:16px 20px;">
                                        ${u.role === 'pending' ? `<span class="badge" style="background:#fff3cd; color:#856404; border:1px solid #ffeeba;">Pending Approval</span>` : `<span class="badge" style="background:var(--bg-hover); color:var(--text-primary); border:1px solid var(--border-subtle);">${escapeHtml(ROLES[u.role]?.label || u.role)}</span>`}
                                    </td>
                                    <td style="padding:16px 20px; color:${u.zone ? '' : 'var(--text-muted)'};">
                                        ${u.state ? `${escapeHtml(u.state)} State` : (u.zone ? `${escapeHtml(u.zone)} Zone` : (u.role === 'pending' ? 'Unassigned' : 'National Hq'))}
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

            const targetUser = users.find(x => x.id === uid);
            let justApproved = false;

            // Only Admins can change status
            if (userLevel >= 4) {
                const newStatus = document.getElementById('tStatus').value;
                updatePayload.status = newStatus;
                
                // Check if they were just approved
                if (newStatus === 'approved' && targetUser && targetUser.status !== 'approved') {
                    justApproved = true;
                }
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
            
            if (justApproved && targetUser) {
                notifyUserApproved(targetUser.displayName || targetUser.email, targetUser.email);
            }
            
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

    // ── CREATE NEW OFFICER FORM (ADMIN ONLY) ─────────────────────
    const createForm = document.getElementById('createOfficerForm');
    if (createForm) {
        // Auto-map state → zone for the create form
        const newStateSelect = document.getElementById('newOfficerState');
        const newZoneSelect = document.getElementById('newOfficerZone');
        if (newStateSelect && newZoneSelect) {
            newStateSelect.addEventListener('change', (e) => {
                const z = getZoneForState(e.target.value);
                if (z) newZoneSelect.value = z;
            });
        }

        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('newOfficerName').value.trim();
            const email = document.getElementById('newOfficerEmail').value.trim();
            const password = document.getElementById('newOfficerPassword').value;
            const role = document.getElementById('newOfficerRole').value;
            let state = document.getElementById('newOfficerState').value;
            let zone = document.getElementById('newOfficerZone').value;

            if (!name || !email || !password || !role) {
                showToast('Validation Error', 'Please fill in all required fields.', 'error');
                return;
            }

            // Auto-fill zone from state
            if (state && !zone) {
                zone = getZoneForState(state) || '';
            }

            const btn = createForm.querySelector('button[type="submit"]');
            btn.textContent = 'Creating account...';
            btn.disabled = true;

            try {
                const newUid = await createOfficerAccount(email, password, {
                    displayName: name,
                    role: role,
                    state: state,
                    zone: zone
                });

                await logAuditAction(
                    'OFFICER_ACCOUNT_CREATED',
                    'users',
                    newUid,
                    { email, role, state, zone },
                    userData
                );

                showToast('Account Created!', `${name} (${email}) can now log in with the temporary password.`, 'success', 5000);
                createForm.reset();

                setTimeout(() => {
                    loadTeamPage(root, null, userData); // Refresh
                }, 1500);

            } catch (err) {
                console.error(err);
                showToast('Creation Failed', err.message, 'error');
            }

            btn.textContent = '🔑 Create Account & Notify Officer';
            btn.disabled = false;
        });
    }

    // ── BULK CSV UPLOAD HANDLER (ADMIN ONLY) ─────────────────────
    const bulkBtn = document.getElementById('btnBulkUpload');
    if (bulkBtn) {
        bulkBtn.addEventListener('click', async () => {
            const fileInput = document.getElementById('csvUpload');
            if (!fileInput.files.length) {
                showToast('No File', 'Please select a CSV file first.', 'warning');
                return;
            }

            const file = fileInput.files[0];
            const text = await file.text();
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            if (lines.length < 2) {
                showToast('Empty File', 'CSV must have a header row and at least one data row.', 'error');
                return;
            }

            // Parse header
            const header = lines[0].split(',').map(h => h.trim().toLowerCase());
            const nameIdx = header.findIndex(h => h.includes('name'));
            const emailIdx = header.findIndex(h => h.includes('email'));
            const pwIdx = header.findIndex(h => h.includes('password'));
            const roleIdx = header.findIndex(h => h.includes('role'));
            const stateIdx = header.findIndex(h => h.includes('state'));
            const zoneIdx = header.findIndex(h => h.includes('zone'));

            if (nameIdx === -1 || emailIdx === -1 || pwIdx === -1) {
                showToast('Invalid CSV', 'CSV must have columns: Name, Email, Password. Role/State/Zone are optional.', 'error');
                return;
            }

            const rows = lines.slice(1).map(line => {
                const cols = line.split(',').map(c => c.trim());
                return {
                    name: cols[nameIdx] || '',
                    email: cols[emailIdx] || '',
                    password: cols[pwIdx] || '',
                    role: roleIdx >= 0 ? cols[roleIdx] || 'field_officer' : 'field_officer',
                    state: stateIdx >= 0 ? cols[stateIdx] || '' : '',
                    zone: zoneIdx >= 0 ? cols[zoneIdx] || '' : ''
                };
            }).filter(r => r.email && r.password);

            if (rows.length === 0) {
                showToast('No Valid Rows', 'No valid data rows found in the CSV.', 'error');
                return;
            }

            // Show progress UI
            const progressDiv = document.getElementById('bulkProgress');
            const progressBar = document.getElementById('bulkProgressBar');
            const statusText = document.getElementById('bulkStatus');
            progressDiv.style.display = 'block';
            bulkBtn.disabled = true;
            bulkBtn.textContent = 'Processing...';

            let success = 0;
            let failed = 0;
            const errors = [];

            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const pct = Math.round(((i + 1) / rows.length) * 100);
                progressBar.style.width = pct + '%';
                statusText.textContent = `Processing ${i + 1} of ${rows.length}: ${r.email}...`;

                // Auto-fill zone from state
                if (r.state && !r.zone) {
                    r.zone = getZoneForState(r.state) || '';
                }

                try {
                    await createOfficerAccount(r.email, r.password, {
                        displayName: r.name,
                        role: r.role,
                        state: r.state,
                        zone: r.zone
                    });
                    success++;
                } catch (err) {
                    failed++;
                    errors.push(`${r.email}: ${err.message}`);
                }

                // Small delay to avoid Firebase rate limits (150ms is safe threshold)
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            progressBar.style.width = '100%';
            statusText.textContent = `✅ Complete! ${success} created, ${failed} failed.`;
            bulkBtn.textContent = '🚀 Upload & Create All';
            bulkBtn.disabled = false;

            if (failed > 0) {
                showToast('Bulk Upload Done', `${success} accounts created. ${failed} failed. Check console for details.`, 'warning', 8000);
                console.warn('[Bulk Upload] Failed accounts:', errors);
            } else {
                showToast('All Accounts Created!', `${success} officer accounts provisioned successfully.`, 'success', 5000);
            }

            setTimeout(() => {
                loadTeamPage(root, null, userData);
            }, 2000);
        });
    }
}
