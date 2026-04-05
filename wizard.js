/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — DAILY ACTIVITY WIZARD (Paginated Mega-Form)
 * Step 1: Location (Zone / State / LGA / Date) + Facility Count
 * Step 2: Facility Details (Paginated Horizontal Loop)
 * Step 3: Review & Submit (Batch Processing)
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, getDocs, query, where, serverTimestamp, upsertFacility } from "./db.js";
import { clearRoot, navigate, showLoading, showToast, buildFormFields, renderWizardProgress, validateForm, renderConditionalFields, initFormChoices } from "./ui.js";
import { ZONES, DAILY_ACTIVITIES, DAILY_ACTIVITY_KEYS, LGA_BY_STATE, getTodayStr } from "./constants.js";
import { logAuditAction } from "./audit.js";

let currentUser = null;
let currentUserData = null;
let wizardState = {};

export const initWizard = (user, userData) => {
    currentUser = user;
    currentUserData = userData;
};

export const startReportWizard = async (root) => {
    wizardState = {
        step: 0,
        inspectionDate: getTodayStr(),
        zone: currentUserData?.zone || '',
        state: currentUserData?.state || '',
        lga: '',
        inspectorNames: [],
        facilityCount: 1,
        currentFacIndex: 0, // Paginated index tracker
        facilities: [] 
    };
    renderCurrentStep(root);
};

const STEP_LABELS = ['Location Basics', 'Facility Reports', 'Review & Submit'];

function renderCurrentStep(root) {
    clearRoot(root);
    switch (wizardState.step) {
        case 0: renderStep_Location(root); break;
        case 1: renderStep_Details(root); break;
        case 2: renderStep_Review(root); break;
    }
}

// ─── STEP 1: ZONE / STATE / LGA / DATE / COUNT ───────────────────
function renderStep_Location(root) {
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 700px; margin: 0 auto;">
        ${renderWizardProgress(STEP_LABELS, 0)}
        <div class="card">
            <h2 style="margin-bottom: 4px;">📍 Logistics Initialization</h2>
            <p class="muted small" style="margin-bottom: 24px;">Declare routing parameters for this operation batch.</p>

            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label>Zone <span style="color:var(--danger);">*</span></label>
                    <select id="wizZone" required>
                        <option value="">Select Zone...</option>
                        ${Object.keys(ZONES).map(z => `<option value="${z}" ${wizardState.zone === z ? 'selected' : ''}>${z}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="flex:1;">
                    <label>State <span style="color:var(--danger);">*</span></label>
                    <select id="wizState" required><option value="">Select Zone first...</option></select>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label>LGA / Area <span style="color:var(--danger);">*</span></label>
                    <select id="wizLga" required><option value="">Select State first...</option></select>
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Report Date <span style="color:var(--danger);">*</span></label>
                    <input type="date" id="wizDate" value="${wizardState.inspectionDate}" required>
                </div>
            </div>

            <div class="form-row" style="margin-top: 12px; align-items: flex-end;">
                <div class="form-group" style="flex:2;">
                    <label>Officer(s) Involved</label>
                    <div id="wizOfficersWrapper">
                        <select id="wizOfficers" multiple data-choices="true" placeholder="Select your team..."></select>
                    </div>
                    <div class="input-hint">Your name is added automatically.</div>
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Facilities Visited <span style="color:var(--danger);">*</span></label>
                    <input type="number" id="wizFacilityCount" min="1" max="100" value="${wizardState.facilityCount}" required>
                </div>
            </div>

            <div class="controls" style="justify-content: space-between; margin-top: 24px;">
                <button class="secondary" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'home' }))">Cancel</button>
                <button id="nextBtn" class="primary">Next →</button>
            </div>
        </div>
    </div>`;

    const zoneSelect = document.getElementById('wizZone');
    const stateSelect = document.getElementById('wizState');
    const lgaSelect = document.getElementById('wizLga');

    const populateStates = () => {
        const zone = zoneSelect.value;
        stateSelect.innerHTML = '<option value="">Select State...</option>';
        lgaSelect.innerHTML = '<option value="">Select State first...</option>';
        if (ZONES[zone]) {
            ZONES[zone].forEach(s => {
                const opt = document.createElement('option');
                opt.value = s; opt.textContent = s;
                if (wizardState.state === s) opt.selected = true;
                stateSelect.appendChild(opt);
            });
            if (wizardState.state) populateLGAs();
        }
    };

    const populateLGAs = () => {
        const state = stateSelect.value;
        lgaSelect.innerHTML = '<option value="">Select LGA...</option>';
        const lgas = LGA_BY_STATE[state] || [];
        lgas.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l; opt.textContent = l;
            if (wizardState.lga === l) opt.selected = true;
            lgaSelect.appendChild(opt);
        });
    };

    const populateOfficers = async () => {
        const state = stateSelect.value;
        const wrapper = document.getElementById('wizOfficersWrapper');
        
        if (!state) {
            wrapper.innerHTML = `<select id="wizOfficers" multiple data-choices="true" placeholder="Waiting for State..."></select>`;
            initFormChoices(root);
            return;
        }

        wrapper.innerHTML = `<select id="wizOfficers" multiple data-choices="true" placeholder="Searching team roster..."></select>`;
        const officersSelect = document.getElementById('wizOfficers');

        try {
            const q = query(collection(db, "users"), where("state", "==", state));
            const snap = await getDocs(q);
            
            let options = '';
            snap.forEach(d => {
                const u = d.data();
                const userName = u.displayName || u.email;
                if (userName !== currentUserData.displayName && u.email !== currentUserData.email) {
                    options += `<option value="${userName}">${userName}</option>`;
                }
            });

            if (!options) {
                officersSelect.innerHTML = '<option value="" disabled>No other officers in this state.</option>';
            } else {
                officersSelect.innerHTML = options;
            }

            if (wizardState.inspectorNames && wizardState.inspectorNames.length > 0) {
                Array.from(officersSelect.options).forEach(opt => {
                    if (wizardState.inspectorNames.includes(opt.value)) opt.selected = true;
                });
            }
            initFormChoices(root);
        } catch(e) {
            console.error("Error loading officers", e);
        }
    };

    zoneSelect.onchange = populateStates;
    stateSelect.onchange = () => { populateLGAs(); populateOfficers(); };
    
    if (wizardState.zone) populateStates();
    if (wizardState.state) populateOfficers(); else initFormChoices(root);

    document.getElementById('nextBtn').onclick = () => {
        const zone = zoneSelect.value;
        const state = stateSelect.value;
        const lga = lgaSelect.value;
        const date = document.getElementById('wizDate').value;
        const fCount = Number(document.getElementById('wizFacilityCount').value) || 1;

        if (!zone || !state || !lga || !date || fCount < 1) {
            showToast('Missing Fields', 'Please complete all location basics.', 'warning');
            return;
        }

        wizardState.zone = zone;
        wizardState.state = state;
        wizardState.lga = lga;
        wizardState.inspectionDate = date;
        wizardState.facilityCount = fCount;

        const officerSelect = document.getElementById('wizOfficers');
        let manual = [];
        if (officerSelect && officerSelect.selectedOptions) {
            manual = Array.from(officerSelect.selectedOptions).map(opt => opt.value);
        }
        const userName = currentUserData?.displayName || currentUser?.displayName || currentUser?.email || '';
        wizardState.inspectorNames = [...new Set([userName, ...manual])].filter(Boolean);

        // Map Facilities Array
        if (wizardState.facilities.length !== fCount) {
            const oldFacs = wizardState.facilities;
            wizardState.facilities = Array(fCount).fill(null).map((_, i) => {
                return oldFacs[i] || { activityKey: '', formData: {}, conditionalData: {} };
            });
        }

        wizardState.currentFacIndex = 0; // Fresh paginated start
        wizardState.step = 1;
        renderCurrentStep(root);
    };
}

// ─── STEP 2: DYNAMIC PAGINATED MEGA-FORM ──────────────────────────
function renderStep_Details(root) {
    const idx = wizardState.currentFacIndex;
    const fac = wizardState.facilities[idx];
    const total = wizardState.facilityCount;

    const actOptions = DAILY_ACTIVITY_KEYS.map(key => {
        const act = DAILY_ACTIVITIES[key];
        const sel = fac.activityKey === key ? 'selected' : '';
        return `<option value="${key}" ${sel}>${act.label}</option>`;
    }).join('');

    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 900px; margin: 0 auto;">
        ${renderWizardProgress(STEP_LABELS, 1)}

        <div class="card" style="margin-bottom: 24px; border: 2px solid var(--primary); border-top: 6px solid var(--primary); border-radius: 8px;">
            <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 24px;">
                <h2 style="margin:0; font-size: 24px;">Facility ${idx + 1} of ${total}</h2>
            </div>
            
            <div class="form-row" style="margin-bottom: 20px;">
                <div class="form-group" style="flex:1;">
                    <label style="color:var(--primary); font-weight:700;">DATE</label>
                    <input type="date" value="${wizardState.inspectionDate}" disabled style="background:var(--bg-tertiary); max-width:200px;">
                </div>
                <div class="form-group" style="flex:1;">
                    <label style="color:var(--primary); font-weight:700;">AREA</label>
                    <input type="text" value="${wizardState.lga}" disabled style="background:var(--bg-tertiary);">
                </div>
            </div>

            <div class="form-group" style="margin-bottom: 20px;">
                <label style="color:var(--primary); font-weight:700;">ACTIVITY TYPE <span style="color:var(--danger);">*</span></label>
                <select class="activity-selector" required>
                    <option value="">Select Activity Type...</option>
                    ${actOptions}
                </select>
            </div>
            
            <div id="dynamicFields"></div>

            <div class="controls" style="display: flex; justify-content: space-between; margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border-subtle);">
                <button class="secondary btn-lg" id="backBtn" style="min-width: 140px;">← BACK</button>
                <button id="nextBtn" class="success btn-lg" style="min-width: 140px; font-weight: 700;">
                    ${idx === total - 1 ? 'REVIEW BATCH' : 'NEXT FACILITY'}
                </button>
            </div>
        </div>
    </div>`;

    const sel = root.querySelector('.activity-selector');
    const block = root.querySelector('#dynamicFields');

    const renderActivityFields = () => {
        const key = sel.value;
        fac.activityKey = key;
        
        if (!key) { block.innerHTML = ''; return; }
        const actDef = DAILY_ACTIVITIES[key];
        
        let fieldsHtml = '';
        const hasFacility = actDef.fields.some(f => f.name === 'facilityName');
        const hasAddress = actDef.fields.some(f => f.name === 'facilityAddress');
        const otherFields = actDef.fields.filter(f => f.name !== 'facilityName' && f.name !== 'facilityAddress' && f.name !== 'actionTaken' && f.name !== 'remarks');
        const actionFields = actDef.fields.filter(f => f.name === 'actionTaken' || f.name === 'remarks');

        if (hasFacility || hasAddress) {
            const facField = actDef.fields.find(f => f.name === 'facilityName');
            const addrField = actDef.fields.find(f => f.name === 'facilityAddress');
            fieldsHtml += `
            <div class="form-row" style="margin-top:16px;">
                <div class="form-group" style="flex:1;">
                    <label style="color:var(--primary); font-weight:700;">FACILITY NAME ${facField?.required ? '<span style="color:var(--danger);">*</span>' : ''}</label>
                    <input type="text" name="facilityName" placeholder="${facField?.placeholder || ''}" ${facField?.required ? 'required' : ''}>
                </div>
                <div class="form-group" style="flex:1;">
                    <label style="color:var(--primary); font-weight:700;">FACILITY ADDRESS ${addrField?.required ? '<span style="color:var(--danger);">*</span>' : ''}</label>
                    <input type="text" name="facilityAddress" placeholder="${addrField?.placeholder || ''}" ${addrField?.required ? 'required' : ''}>
                </div>
            </div>`;
        }
        fieldsHtml += buildFormFields(otherFields, { labelStyle: 'color:var(--primary); font-weight:700;' });
        if (actDef.conditionals) fieldsHtml += renderConditionalFields(actDef.conditionals);
        
        // Append Action Taken / Remarks at the absolute bottom
        if (actionFields.length > 0) {
            fieldsHtml += buildFormFields(actionFields, { labelStyle: 'color:var(--primary); font-weight:700;' });
        }

        block.innerHTML = fieldsHtml;
        restoreFormData(block, idx);
        bindConditionalToggles(block, idx);
        initFormChoices(block);
        populateAlertDropdowns(block);

        // -- Contextual Facility Linker (Consultative Meetings) --
        const srcActSel = block.querySelector('[name="sourceActivity"]');
        const facNameSel = block.querySelector('[data-facility-search="true"]');
        const newFacWrapper = block.querySelector('#newFacWrapper');
        const newFacInput = block.querySelector('#newFacInput');

        if (srcActSel && facNameSel) {
            srcActSel.addEventListener('change', async (e) => {
                const chosenSource = e.target.value;
                if (!chosenSource) {
                    facNameSel.innerHTML = '<option value="">Select a Source Activity first...</option>';
                    newFacWrapper.style.display = 'none';
                    newFacInput.removeAttribute('name');
                    facNameSel.setAttribute('name', 'facilityName');
                    return;
                }
                facNameSel.innerHTML = '<option value="">Searching Local Cache...</option>';
                try {
                    const q2 = query(collection(db, "facilityReports"), where("state", "==", wizardState.state), where("activityType", "==", chosenSource));
                    const snap = await getDocs(q2);
                    
                    let uniqueFacs = new Set();
                    snap.forEach(d => {
                        const rec = d.data();
                        if (rec.facilityName) uniqueFacs.add(rec.facilityName);
                    });
                    
                    if (snap.empty) {
                        facNameSel.innerHTML = '<option value="__ADD_NEW__">⚠️ Offline: No Cached Records. + Add New...</option>';
                        newFacWrapper.style.display = 'block';
                        facNameSel.removeAttribute('name');
                        newFacInput.setAttribute('name', 'facilityName');
                        newFacInput.placeholder = "Enter name manually...";
                    } else {
                        let optionsHtml = '<option value="">Select Facility...</option>';
                        optionsHtml += Array.from(uniqueFacs).sort().map(fn => `<option value="${fn}">${fn}</option>`).join('');
                        optionsHtml += '<option value="__ADD_NEW__" style="font-weight:bold; color:var(--primary);">+ Add New Facility...</option>';
                        
                        facNameSel.innerHTML = optionsHtml;

                        // restore value if we have one
                        if (fac.formData.facilityName) {
                            if (uniqueFacs.has(fac.formData.facilityName)) {
                                facNameSel.value = fac.formData.facilityName;
                            } else {
                                facNameSel.value = "__ADD_NEW__";
                                newFacWrapper.style.display = 'block';
                                facNameSel.removeAttribute('name');
                                newFacInput.setAttribute('name', 'facilityName');
                                newFacInput.value = fac.formData.facilityName;
                            }
                        }
                    }
                } catch(err) {
                    console.error("Facility load error", err);
                    facNameSel.innerHTML = '<option value="__ADD_NEW__">⚠️ Connection Lost. + Add manually...</option>';
                    newFacWrapper.style.display = 'block';
                }
            });

            facNameSel.addEventListener('change', (e) => {
                if (e.target.value === '__ADD_NEW__') {
                    newFacWrapper.style.display = 'block';
                    facNameSel.removeAttribute('name');
                    newFacInput.setAttribute('name', 'facilityName');
                    newFacInput.focus();
                } else {
                    newFacWrapper.style.display = 'none';
                    facNameSel.setAttribute('name', 'facilityName');
                    newFacInput.removeAttribute('name');
                }
            });

            // Trigger fetch automatically on re-render if a source exists in memory
            if (fac.formData && fac.formData.sourceActivity) {
                setTimeout(() => srcActSel.dispatchEvent(new Event('change')), 50);
            }
        }
    };

    sel.onchange = renderActivityFields;
    if (sel.value) renderActivityFields();

    document.getElementById('backBtn').onclick = () => {
        saveAllFormData(root, idx);
        if (wizardState.currentFacIndex > 0) {
            wizardState.currentFacIndex--;
            renderCurrentStep(root);
        } else {
            wizardState.step = 0;
            renderCurrentStep(root);
        }
    };

    document.getElementById('nextBtn').onclick = () => {
        saveAllFormData(root, idx);
        
        if (!fac.activityKey) {
            showToast('Missing Activity', `Please select an Activity Type.`, 'warning');
            return;
        }
        const actDef = DAILY_ACTIVITIES[fac.activityKey];
        const required = actDef.fields.filter(f => f.required).map(f => f.name);
        
        let hasMissing = false;
        required.forEach(reqKey => {
            if(!fac.formData[reqKey]) hasMissing = true;
        });
        
        if (hasMissing) {
            showToast('Missing Fields', `Please fill all required fields.`, 'warning');
            return;
        }

        if (wizardState.currentFacIndex < total - 1) {
            wizardState.currentFacIndex++;
            renderCurrentStep(root);
        } else {
            wizardState.step = 2; // Move to Review Screen
            renderCurrentStep(root);
        }
    };
}

// ─── FORM DATA HELPERS (Paginated) ──────────────────────────────
function saveAllFormData(root, idx) {
    const fac = wizardState.facilities[idx];
    const block = root.querySelector('#dynamicFields');
    if(!block) return;
    const data = {};
    block.querySelectorAll('input, select, textarea').forEach(el => {
        if (['file', 'button'].includes(el.type)) return;
        if (!el.name) return;
        if (el.multiple) {
            data[el.name] = Array.from(el.selectedOptions || []).map(o => o.value);
        } else {
            data[el.name] = el.value;
        }
    });
    fac.formData = { ...fac.formData, ...data };
}

function restoreFormData(container, idx) {
    const fac = wizardState.facilities[idx];
    if (!fac.formData || Object.keys(fac.formData).length === 0) return;
    Object.entries(fac.formData).forEach(([key, val]) => {
        const input = container.querySelector(`[name="${key}"]`);
        if (input && !input.multiple) input.value = val;
    });
}

function bindConditionalToggles(container, idx) {
    const fac = wizardState.facilities[idx];
    container.querySelectorAll('.conditional-toggle').forEach(toggle => {
        const targetId = toggle.dataset.target;
        const yesBtn = toggle.querySelector('[data-val="yes"]');
        const noBtn = toggle.querySelector('[data-val="no"]');
        const subFields = container.querySelector(`#${targetId}`);
        const triggerName = toggle.dataset.name;

        if (fac.conditionalData[triggerName] === 'yes') {
            yesBtn.classList.add('active');
            noBtn.classList.remove('active');
            if (subFields) { subFields.style.display = 'block'; initFormChoices(subFields); }
        } else if (fac.conditionalData[triggerName] === 'no') {
            noBtn.classList.add('active');
        }

        yesBtn.onclick = () => {
            yesBtn.classList.add('active'); noBtn.classList.remove('active');
            if (subFields) { subFields.style.display = 'block'; initFormChoices(subFields); }
            fac.conditionalData[triggerName] = 'yes';
        };
        noBtn.onclick = () => {
            noBtn.classList.add('active'); yesBtn.classList.remove('active');
            if (subFields) subFields.style.display = 'none';
            fac.conditionalData[triggerName] = 'no';
        };
    });
}


// ─── STEP 3: REVIEW & BATCH SUBMIT ──────────────────────────────
function renderStep_Review(root) {
    
    let summaryHtml = '';
    wizardState.facilities.forEach((fac, i) => {
        const actDef = DAILY_ACTIVITIES[fac.activityKey];
        const fd = fac.formData;

        const fieldRows = actDef.fields.map(f => {
            let val = fd[f.name];
            if (Array.isArray(val)) val = val.join(', ');
            return `<tr><td style="font-weight:600; color:var(--text-secondary); width:30%;">${f.label}</td><td>${val || '—'}</td></tr>`;
        }).join('');

        let condRows = '';
        if (actDef.conditionals) {
            actDef.conditionals.forEach(c => {
                const trigVal = fac.conditionalData[c.trigger.name];
                condRows += `<tr><td style="font-weight:600; color:var(--text-secondary);">${c.trigger.label}</td><td>${trigVal === 'yes' ? '✅ Yes' : '❌ No'}</td></tr>`;
                if (trigVal === 'yes') {
                    c.fields.forEach(f => {
                        let val = fd[f.name];
                        if (Array.isArray(val)) val = val.join(', ');
                        condRows += `<tr><td style="font-weight:600; color:var(--text-muted); padding-left:24px;">${f.label}</td><td>${val || '—'}</td></tr>`;
                    });
                }
            });
        }

        summaryHtml += `
        <div style="background: var(--bg-tertiary); border-radius: var(--radius-sm); padding: 16px; border: 1px solid var(--border-subtle); margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-subtle); padding-bottom:8px;">
                <span style="font-size: 24px;">${actDef.icon}</span>
                <div>
                    <h4 style="margin:0; font-size:16px;">Facility ${i + 1}: ${fd.facilityName || 'Unnamed Facility'}</h4>
                    <p class="muted small" style="margin:0;">${actDef.label}</p>
                </div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:14px;">
                <tbody>
                    ${fieldRows}
                    ${condRows}
                </tbody>
            </table>
        </div>`;
    });

    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 800px; margin: 0 auto;">
        ${renderWizardProgress(STEP_LABELS, 2)}
        <div class="card">
            <h2 style="margin-bottom: 4px;">✅ Review Batch</h2>
            <p class="muted small" style="margin-bottom: 24px;">Verify the ${wizardState.facilityCount} reports before database injection.</p>

            ${summaryHtml}

            <div class="controls" style="justify-content: space-between;">
                <button class="secondary btn-lg" id="backBtn">← EDIT BATCH</button>
                <button class="success btn-lg" id="submitBtn">⚡ TRANSMIT BATCH</button>
            </div>
        </div>
    </div>`;

    document.getElementById('backBtn').onclick = () => { 
        wizardState.currentFacIndex = 0; // go back to first form
        wizardState.step = 1; 
        renderCurrentStep(root); 
    };
    document.getElementById('submitBtn').onclick = () => submitReportBatch(root);
}

async function submitReportBatch(root) {
    showLoading(root, `Transmitting ${wizardState.facilityCount} records...`);

    try {
        const promises = wizardState.facilities.map(async fac => {
            const actDef = DAILY_ACTIVITIES[fac.activityKey];
            const report = {
                activityType: actDef.label,
                activityKey: fac.activityKey,
                category: actDef.category,
                zone: wizardState.zone,
                state: wizardState.state,
                lga: wizardState.lga,
                inspectionDate: wizardState.inspectionDate,
                year: new Date(wizardState.inspectionDate).getFullYear(),
                month: new Date(wizardState.inspectionDate).getMonth() + 1,
                day: new Date(wizardState.inspectionDate).getDate(),
                inspectorNames: wizardState.inspectorNames,
                conditionalData: fac.conditionalData,
                ...fac.formData,
                createdBy: currentUser.uid,
                createdByEmail: currentUser.email,
                createdByName: currentUserData?.displayName || currentUser.displayName || currentUser.email,
                createdAt: serverTimestamp()
            };

            // Number field normalization
            actDef.fields.forEach(f => {
                if (f.type === 'number' && report[f.name]) { report[f.name] = Number(report[f.name]); }
            });

            const dr = await addDoc(collection(db, 'facilityReports'), report);
            await logAuditAction('DAILY_ACTIVITY_LOGGED', 'facilityReports', dr.id, { activityType: report.activityType, facility: report.facilityName }, currentUser);

            if (report.facilityName) {
                try {
                    await upsertFacility({
                        facilityName: report.facilityName,
                        facilityAddress: report.facilityAddress || '',
                        zone: report.zone,
                        state: report.state,
                        lga: report.lga,
                        inspectionDate: report.inspectionDate,
                        activityType: report.activityType
                    }, report.state);
                } catch (err) { console.error("Facility upsert err:", err); }
            }
        });

        await Promise.all(promises);

        showToast('Batch Submitted', `Successfully injected ${wizardState.facilityCount} records.`, 'success');
        renderSuccess(root);

    } catch(err) {
        console.error("Batch Submission error:", err);
        showToast('Submission Failed', err.message, 'error');
        wizardState.step = 2;
        renderCurrentStep(root);
    }
}

function renderSuccess(root) {
    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width: 600px; margin: 60px auto; text-align: center;">
        <div class="card" style="padding: 48px;">
            <div style="font-size: 64px; margin-bottom: 16px;">🎉</div>
            <h1 class="text-gradient" style="font-size: 28px; margin-bottom: 8px;">Batch Successful</h1>
            <p class="muted" style="font-size: 15px; margin-bottom: 32px;">
                All <strong>${wizardState.facilityCount}</strong> activity reports have been permanently synchronized and facility dossiers updated.
            </p>
            <div style="display:flex; gap:12px; justify-content: center; flex-wrap: wrap;">
                <button class="secondary" onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'activity' }))">
                    ⚡ Start New Sweep
                </button>
                <button onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'home' }))">
                    🏠 Return to Dashboard
                </button>
            </div>
        </div>
    </div>`;
}

// ── ASYNC DROPDOWN POPULATORS ───────────────────────────────────
async function populateAlertDropdowns(container) {
    const selects = container.querySelectorAll('select[data-alert-dropdown="true"]');
    if (!selects.length) return;
    try {
        const snap = await getDocs(query(collection(db, 'alerts')));
        const alerts = snap.docs.map(d => d.data());
        selects.forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">Select from active alerts...</option>' + 
                alerts.map(a => {
                    const title = a.productName || a.title || 'Unnamed Alert Product';
                    return `<option value="${title}" ${currentVal === title ? 'selected' : ''}>${title}</option>`;
                }).join('');
        });
    } catch (e) {
        console.error("Alerts load error:", e);
        selects.forEach(sel => sel.innerHTML = '<option value="">Error loading alerts</option>');
    }
}
