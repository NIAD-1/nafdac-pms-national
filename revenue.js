/**
 * NAFDAC PMS v3 — REVENUE MODULE
 * Track sanctions from consultative meetings + manual entries.
 */
import { db, collection, addDoc, getDocs, query, where, doc, updateDoc, serverTimestamp, updateFacilityFinances } from "./db.js";
import { getUserScope } from "./auth.js";
import { clearRoot, showToast, buildFormFields } from "./ui.js";
import { REVENUE_FIELDS, formatCurrency, getTodayStr, getCurrentYear } from "./constants.js";

export async function loadRevenuePage(root, currentUser, currentUserData) {
    clearRoot(root);
    root.innerHTML = `
    <div class="animate-fade-in" style="max-width:1000px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <div><h1 style="margin-bottom:4px;">💰 Revenue & Sanctions</h1>
            <p class="muted small">Sanctions from consultative meetings and manual revenue entries.</p></div>
            <button id="btnNewRevenue">+ Manual Entry</button>
        </div>
        <div id="revSummary" style="margin-bottom:20px;"></div>
        <div id="revContent"></div>
    </div>`;
    const content = document.getElementById('revContent');
    const summary = document.getElementById('revSummary');
    document.getElementById('btnNewRevenue').onclick = () => renderRevForm(content, currentUser, currentUserData, summary);
    await loadRevData(content, summary, currentUserData);
}

async function loadRevData(container, summaryEl, userData) {
    container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-lg"></div></div>';
    const scope = getUserScope();

    try {
        // Build scoped queries
        let revQ, meetQ;
        if (scope.state) {
            revQ = query(collection(db, 'revenue'), where('state', '==', scope.state));
            meetQ = query(collection(db, 'facilityReports'), where('activityKey', '==', 'consultative_meeting'), where('state', '==', scope.state));
        } else if (scope.zone) {
            revQ = query(collection(db, 'revenue'), where('zone', '==', scope.zone));
            meetQ = query(collection(db, 'facilityReports'), where('activityKey', '==', 'consultative_meeting'), where('zone', '==', scope.zone));
        } else {
            revQ = query(collection(db, 'revenue'));
            meetQ = query(collection(db, 'facilityReports'), where('activityKey', '==', 'consultative_meeting'));
        }

        const revSnap = await getDocs(revQ);
        const revenues = revSnap.docs.map(d => ({ id: d.id, src: 'manual', ...d.data() }));
        
        const meetSnap = await getDocs(meetQ);
        const meetSanctions = meetSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(m => m.conditionalData?.wasSanctionGiven === 'yes')
            .map(m => ({ id: m.id, src: 'meeting', facilityName: m.facilityName||'—', amount: Number(m.sanctionAmount)||0,
                offence: m.sanctionDetails||'Consultative meeting sanction', paymentStatus: m.paymentStatus||'Unpaid',
                year: m.year||getCurrentYear(), state: m.state, dateLogged: m.inspectionDate, createdByName: m.createdByName }));
        const all = [...revenues, ...meetSanctions];
        const totSanc = all.reduce((s,r) => s+(Number(r.amount)||0), 0);
        const totPaid = all.filter(r => r.paymentStatus==='Paid').reduce((s,r) => s+(Number(r.amount)||0), 0);
        summaryEl.innerHTML = `<div class="stat-cards">
            <div class="stat-card"><div class="stat-card-icon">💰</div><div class="stat-card-title">Total Sanctioned</div><div class="stat-card-value" style="font-size:20px;">${formatCurrency(totSanc)}</div></div>
            <div class="stat-card" style="border-left:3px solid var(--success);"><div class="stat-card-icon">✅</div><div class="stat-card-title">Paid</div><div class="stat-card-value" style="font-size:20px;color:var(--success);">${formatCurrency(totPaid)}</div></div>
            <div class="stat-card" style="border-left:3px solid var(--danger);"><div class="stat-card-icon">⏳</div><div class="stat-card-title">Outstanding</div><div class="stat-card-value" style="font-size:20px;color:var(--danger);">${formatCurrency(totSanc-totPaid)}</div></div>
        </div>`;
        if (!all.length) { container.innerHTML = `<div class="card" style="text-align:center;padding:48px;"><div style="font-size:48px;margin-bottom:12px;">💰</div><h3>No Revenue Entries</h3><p class="muted small">Revenue from consultative meeting sanctions and manual entries will appear here.</p></div>`; return; }
        const badge = s => `<span class="badge ${s==='Paid'?'badge-green':s==='Unpaid'?'badge-red':'badge-yellow'}">${s}</span>`;
        container.innerHTML = `<div class="card" style="padding:0;overflow:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:var(--bg-tertiary);text-align:left;"><th style="padding:12px 16px;font-size:12px;color:var(--text-secondary);">SOURCE</th><th style="padding:12px 16px;font-size:12px;color:var(--text-secondary);">FACILITY</th><th style="padding:12px 16px;font-size:12px;color:var(--text-secondary);">AMOUNT</th><th style="padding:12px 16px;font-size:12px;color:var(--text-secondary);">OFFENCE</th><th style="padding:12px 16px;font-size:12px;color:var(--text-secondary);">STATUS</th><th style="padding:12px 16px;font-size:12px;color:var(--text-secondary);">ACTION</th></tr></thead>
            <tbody>${all.map(r => `<tr style="border-top:1px solid var(--border-subtle);"><td style="padding:12px 16px;font-size:12px;"><span class="badge" style="font-size:10px;">${r.src==='meeting'?'🤝 Meeting':'✍️ Manual'}</span></td><td style="padding:12px 16px;font-size:13px;font-weight:600;">${r.facilityName||'—'}</td><td style="padding:12px 16px;font-size:13px;font-weight:700;">${formatCurrency(r.amount)}</td><td style="padding:12px 16px;font-size:13px;">${(r.offence||'—').substring(0,50)}</td><td style="padding:12px 16px;">${badge(r.paymentStatus)}</td><td style="padding:12px 16px;">${r.paymentStatus!=='Paid'&&r.src==='manual'?`<button class="secondary" style="padding:4px 12px;font-size:11px;" data-mp="${r.id}" data-fac="${r.facilityName||''}" data-state="${r.state||''}" data-amt="${r.amount||0}">Mark Paid</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
        
        container.querySelectorAll('[data-mp]').forEach(btn => { 
            btn.onclick = async () => {
                try { 
                    const amt = Number(btn.dataset.amt) || 0;
                    await updateDoc(doc(db,'revenue',btn.dataset.mp),{paymentStatus:'Paid',paidAt:serverTimestamp()}); 
                    
                    if (btn.dataset.fac && btn.dataset.fac !== '—') {
                        await updateFacilityFinances(btn.dataset.fac, btn.dataset.state, { amountOwedDelta: -amt, amountPaidDelta: amt });
                    }
                    
                    showToast('Updated','Payment set to Paid.','success'); 
                    loadRevData(container,summaryEl,userData); 
                } catch(e) { 
                    showToast('Error',e.message,'error'); 
                }
            };
        });
    } catch(err) { container.innerHTML = `<div class="card"><p class="muted">Error: ${err.message}</p></div>`; }
}

function renderRevForm(container, currentUser, userData, summaryEl) {
    container.innerHTML = `<div class="card animate-fade-in"><h2 style="margin-bottom:4px;">💰 Manual Revenue Entry</h2><p class="muted small" style="margin-bottom:20px;">Log a sanction or revenue entry manually.</p>
        <form id="revForm">${buildFormFields(REVENUE_FIELDS, {labelStyle:'color:var(--primary);font-weight:700;'})}
        <div class="controls" style="justify-content:flex-end;margin-top:20px;gap:12px;"><button type="button" class="secondary" id="cancelRev">Cancel</button><button type="submit" class="success">Submit</button></div></form></div>`;
    document.getElementById('cancelRev').onclick = () => loadRevData(container, summaryEl, userData);
    document.getElementById('revForm').onsubmit = async (e) => {
        e.preventDefault(); const data = {};
        REVENUE_FIELDS.forEach(f => { const el = e.target.querySelector(`[name="${f.name}"]`); if (el) data[f.name] = el.value; });
        if (data.amount) data.amount = Number(data.amount);
        if (data.year) data.year = Number(data.year);
        data.dateLogged = getTodayStr(); data.state = userData?.state||''; data.zone = userData?.zone||'';
        data.createdBy = currentUser.uid; data.createdByName = userData?.displayName||currentUser.email; data.createdAt = serverTimestamp();
        try { 
            await addDoc(collection(db,'revenue'),data); 
            
            const isPaid = data.paymentStatus === 'Paid';
            await updateFacilityFinances(data.facilityName, data.state, {
                sanctionsDelta: 1,
                amountOwedDelta: isPaid ? 0 : data.amount,
                amountPaidDelta: isPaid ? data.amount : 0
            });
            
            showToast('Logged','Revenue entry saved.','success'); 
            loadRevData(container,summaryEl,userData); 
        }
        catch(err) { showToast('Error',err.message,'error'); }
    };
}
