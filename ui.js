/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v2 — UI UTILITIES
 * Toast, modal, form builder, conditional fields, wizard progress.
 * ═══════════════════════════════════════════════════════════════
 */

let currentPage = 'home';
let choicesInstances = [];

export function addChoicesInstance(inst) { choicesInstances.push(inst); }

export const clearRoot = (el) => {
    if (!el) return;
    choicesInstances.forEach(c => { try { c.destroy(); } catch(e) {} });
    choicesInstances = [];
    el.innerHTML = '';
};

export const navigate = (page) => {
    currentPage = page;
    window.dispatchEvent(new CustomEvent('navigate', { detail: page }));
};

// === TOAST NOTIFICATIONS ======================================
export function showToast(title, message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || '📢'}</span>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            ${message ? `<div class="toast-msg">${message}</div>` : ''}
        </div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}

// === MODAL ====================================================
export function showModal(title, bodyHtml, onConfirm, confirmText = 'Confirm') {
    const container = document.getElementById('modalContainer');
    container.innerHTML = `
        <div class="modal-backdrop" id="modalOverlay">
            <div class="modal-content animate-fade-in">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button id="modalClose" style="background:transparent;color:var(--text-muted);font-size:24px;padding:4px 8px;">✕</button>
                </div>
                <div class="modal-body">${bodyHtml}</div>
                <div class="controls" style="justify-content: flex-end; margin-top: 20px;">
                    <button class="secondary" id="modalCancelBtn">Cancel</button>
                    ${onConfirm ? `<button class="success" id="modalConfirmBtn">${confirmText}</button>` : ''}
                </div>
            </div>
        </div>`;
    const close = () => container.innerHTML = '';
    document.getElementById('modalClose').onclick = close;
    document.getElementById('modalCancelBtn').onclick = close;
    document.getElementById('modalOverlay').onclick = (e) => { if (e.target.id === 'modalOverlay') close(); };
    if (onConfirm && document.getElementById('modalConfirmBtn')) {
        document.getElementById('modalConfirmBtn').onclick = () => { onConfirm(); close(); };
    }
}

// === LOADING ==================================================
export function showLoading(root, msg = 'Loading...') {
    root.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;">
            <div class="spinner spinner-lg"></div>
            <p class="muted" style="margin-top:16px;">${msg}</p>
        </div>`;
}

// === WIZARD PROGRESS BAR ======================================
export function renderWizardProgress(steps, activeIdx) {
    return `<div class="wizard-progress">
        ${steps.map((s, i) => `
            <div class="wizard-step ${i === activeIdx ? 'active' : ''} ${i < activeIdx ? 'done' : ''}">
                <div class="wizard-step-dot">${i < activeIdx ? '✓' : i + 1}</div>
                <span>${s}</span>
            </div>
            ${i < steps.length - 1 ? `<div class="wizard-step-line ${i < activeIdx ? 'done' : ''}"></div>` : ''}
        `).join('')}
    </div>`;
}

// === FORM FIELD BUILDER =======================================
export function buildFormFields(fields, opts = {}) {
    const labelStyle = opts.labelStyle ? ` style="${opts.labelStyle}"` : '';
    return fields.map(f => {
        const req = f.required ? '<span style="color:var(--danger);">*</span>' : '';
        let input = '';

        switch (f.type) {
            case 'text':
                input = `<input type="text" name="${f.name}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}>`;
                break;
            case 'number':
                input = `<input type="number" name="${f.name}" placeholder="${f.placeholder || '0'}" min="0" ${f.required ? 'required' : ''}>`;
                break;
            case 'date':
                input = `<input type="date" name="${f.name}" ${f.required ? 'required' : ''}>`;
                break;
            case 'textarea':
                input = `<textarea name="${f.name}" rows="3" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}></textarea>`;
                break;
            case 'select':
                input = `<select name="${f.name}" ${f.required ? 'required' : ''}>
                    <option value="">Select...</option>
                    ${(f.options || []).map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>`;
                break;
            case 'multiselect':
                input = `<select name="${f.name}" multiple data-choices="true" ${f.required ? 'required' : ''}>
                    ${(f.options || []).map(o => `<option value="${o}">${o}</option>`).join('')}
                </select>`;
                break;
            case 'yesno':
                input = `<div class="yesno-toggle" data-name="${f.name}">
                    <button type="button" class="secondary" data-val="yes" style="padding:8px 20px;">Yes</button>
                    <button type="button" class="secondary" data-val="no" style="padding:8px 20px;">No</button>
                </div>`;
                break;
            case 'alertDropdown':
                input = `<select name="${f.name}" data-alert-dropdown="true">
                    <option value="">Loading alerts...</option>
                </select>
                <div class="input-hint">Products are loaded from the active alerts database</div>`;
                break;
            case 'facilitySearchCombo':
                input = `<select data-facility-search="true" ${f.required ? 'required' : ''}>
                    <option value="">Select a Source Activity first...</option>
                </select>
                <div id="newFacWrapper" style="display:none; margin-top:8px;">
                    <input type="text" id="newFacInput" placeholder="Enter new facility name..." ${f.required ? 'required' : ''}>
                </div>
                <div class="input-hint">Search existing CRM records or click '+ Add New Facility...'.</div>`;
                break;
            default:
                input = `<input type="text" name="${f.name}" placeholder="${f.placeholder || ''}">`;
        }

        return `<div class="form-group">
            <label${labelStyle}>${f.label} ${req}</label>
            ${input}
            ${f.hint ? `<div class="input-hint">${f.hint}</div>` : ''}
        </div>`;
    }).join('');
}

/** Initialize Choices.js on all multiselect elements in a container */
export function initFormChoices(container) {
    if (typeof Choices === 'undefined') return;
    container.querySelectorAll('select[data-choices="true"]').forEach(el => {
        if (el._choicesInstance) return;
        const instance = new Choices(el, {
            removeItemButton: true,
            searchEnabled: true,
            placeholderValue: el.getAttribute('placeholder') || 'Select...',
            searchPlaceholderValue: 'Search...',
            itemSelectText: '',
            shouldSort: false,
            classNames: { containerOuter: 'choices', containerInner: 'choices__inner' }
        });
        el._choicesInstance = instance;
        addChoicesInstance(instance);
    });
}

// === CONDITIONAL FIELD RENDERER ===============================
export function renderConditionalFields(conditionals) {
    if (!conditionals || !conditionals.length) return '';
    return conditionals.map(c => {
        const trigger = c.trigger;
        const targetId = `cond_${trigger.name}`;

        // Check if fields have inline layout (e.g. mop-up category counts)
        const inlineFields = c.fields.filter(f => f.inline);
        const regularFields = c.fields.filter(f => !f.inline);

        let subFieldsHtml = '';
        if (inlineFields.length > 0) {
            subFieldsHtml += `
            <div style="background:var(--bg-secondary); border-radius:var(--radius-sm); padding:16px; margin-bottom:12px; border:1px solid var(--border-subtle);">
                <p style="color:var(--primary); font-weight:700; font-size:13px; margin-bottom:12px;">Enter Counts by Category:</p>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    ${inlineFields.map(f => `
                        <div class="form-group" style="margin:0;">
                            <label style="color:var(--primary); font-weight:700; font-size:12px;">${f.label}</label>
                            <input type="number" name="${f.name}" placeholder="0" min="0" value="0">
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }
        if (regularFields.length > 0) {
            subFieldsHtml += buildFormFields(regularFields, { labelStyle: 'color:var(--primary); font-weight:700;' });
        }

        return `
        <div style="margin-top: 16px; padding: 16px; background: var(--bg-tertiary); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
            <div class="conditional-toggle" data-target="${targetId}" data-name="${trigger.name}" style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 4px;">
                <label style="margin:0; font-weight:700; font-size:13px; color:var(--primary);">${trigger.label}</label>
                <div style="display:flex;gap:4px;">
                    <button type="button" class="secondary" data-val="yes" style="padding:6px 16px;font-size:12px;">Yes</button>
                    <button type="button" class="secondary" data-val="no" style="padding:6px 16px;font-size:12px;">No</button>
                </div>
            </div>
            <div id="${targetId}" style="display:none; margin-top: 12px;">
                ${subFieldsHtml}
            </div>
        </div>`;
    }).join('');
}

// === FORM VALIDATION ==========================================
export function validateForm(container, requiredNames) {
    let valid = true;
    // Remove old error styles
    container.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));

    requiredNames.forEach(name => {
        const input = container.querySelector(`[name="${name}"]`);
        if (input && !input.value) {
            input.classList.add('input-error');
            valid = false;
        }
    });
    return { valid };
}

// === ANIMATED COUNTER =========================================
export function animateCounter(el, target) {
    if (!el) return;
    let current = 0;
    const duration = 600;
    const step = Math.max(1, Math.floor(target / (duration / 16)));
    const timer = setInterval(() => {
        current += step;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        el.textContent = current.toLocaleString();
    }, 16);
}
