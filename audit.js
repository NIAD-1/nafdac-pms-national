/**
 * ═══════════════════════════════════════════════════════════════
 * NAFDAC PMS v3 — AUTOMATED AUDIT LOGGER
 * Silently records structural database mutations to ensure 
 * absolute systemic accountability.
 * ═══════════════════════════════════════════════════════════════
 */
import { db, collection, addDoc, serverTimestamp } from "./db.js";

/**
 * Logs an action to the 'audit_logs' collection
 * @param {string} action - Brief description (e.g., 'TEAM_MEMBER_UPDATED', 'REPORT_FILED')
 * @param {string} targetCollection - The collection affected
 * @param {string} targetId - ID of the document modified
 * @param {object} details - Any arbitrary JSON details describing the change
 * @param {object} user - The user who performed the action
 */
export async function logAuditAction(action, targetCollection, targetId, details, user) {
    try {
        const auditRef = collection(db, 'audit_logs');
        await addDoc(auditRef, {
            action,
            targetCollection,
            targetId,
            details,
            actorUid: user?.uid || 'SYSTEM',
            actorEmail: user?.email || 'SYSTEM',
            actorName: user?.displayName || user?.email || 'SYSTEM',
            timestamp: serverTimestamp()
        });
        console.log(`[AUDIT] ${action} recorded silently.`);
    } catch (err) {
        // We do not throw or alert the user; audit logging failure 
        // should not crash the main application flow.
        console.error("Audit log failed to write:", err);
    }
}
