// ═══════════════════════════════════════════════════════════════
// NAFDAC PMS v2 — FIREBASE DATABASE MODULE
// ═══════════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, orderBy, Timestamp, limit, runTransaction, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC98TWcj1lzG4MtOYpDGt3MxISC5JNW2Yk",
  authDomain: "pms-national.firebaseapp.com",
  projectId: "pms-national",
  storageBucket: "pms-national.firebasestorage.app",
  messagingSenderId: "243598321443",
  appId: "1:243598321443:web:10ad687ac3a3a152f70e96",
  measurementId: "G-1T78ZWE9GB"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = initializeFirestore(app, {
    cache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});
const auth = getAuth(app);

// ── Facility Auto-Upsert (Concurrency-Safe) ────────────────────
export async function upsertFacility(facilityData, userState) {
    if (!facilityData.facilityName) return null;
    const name = facilityData.facilityName.trim();
    const state = userState || facilityData.state || '';
    
    // Deterministic ID prevents duplicate facility docs under Promise.all concurrency
    const cleanState = state.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const docId = `${cleanState}_${cleanName}`;
    const facRef = doc(db, 'facilities', docId);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(facRef);
            if (!docSnap.exists()) {
                transaction.set(facRef, {
                    name: name,
                    address: facilityData.facilityAddress || '',
                    state: state,
                    zone: facilityData.zone || '',
                    totalVisits: 1,
                    lastVisitDate: facilityData.inspectionDate || new Date().toISOString().split('T')[0],
                    lastActivity: facilityData.activityType || '',
                    sanctions: 0,
                    totalPaid: 0,
                    totalOwed: 0,
                    createdAt: serverTimestamp()
                });
            } else {
                const d = docSnap.data();
                transaction.update(facRef, {
                    totalVisits: (d.totalVisits || 0) + 1,
                    lastVisitDate: facilityData.inspectionDate || new Date().toISOString().split('T')[0],
                    lastActivity: facilityData.activityType || '',
                    address: facilityData.facilityAddress || d.address
                });
            }
        });
        return docId;
    } catch (err) {
        console.warn("Facility transaction failed, falling back to setDoc+increment:", err);
        // Fallback for offline mode (runTransaction fails offline)
        await setDoc(facRef, {
            name: name,
            address: facilityData.facilityAddress || '',
            state: state,
            zone: facilityData.zone || '',
            totalVisits: increment(1),
            lastVisitDate: facilityData.inspectionDate || new Date().toISOString().split('T')[0],
            lastActivity: facilityData.activityType || '',
            createdAt: serverTimestamp()
        }, { merge: true });
        return docId;
    }
}

export async function updateFacilityFinances(facilityName, state, deltas) {
    if (!facilityName) return;
    const cleanState = state.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const cleanName = facilityName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    const docId = `${cleanState}_${cleanName}`;
    const facRef = doc(db, 'facilities', docId);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(facRef);
            if (!docSnap.exists()) {
                transaction.set(facRef, {
                    name: facilityName.trim(),
                    state: state,
                    totalVisits: 0,
                    sanctions: deltas.sanctionsDelta || 0,
                    totalPaid: deltas.amountPaidDelta || 0,
                    totalOwed: deltas.amountOwedDelta || 0,
                    createdAt: serverTimestamp()
                });
            } else {
                const d = docSnap.data();
                transaction.update(facRef, {
                    sanctions: (d.sanctions || 0) + (deltas.sanctionsDelta || 0),
                    totalOwed: (d.totalOwed || 0) + (deltas.amountOwedDelta || 0),
                    totalPaid: (d.totalPaid || 0) + (deltas.amountPaidDelta || 0)
                });
            }
        });
    } catch (err) {
        console.warn("Facility finance transaction failed, falling back to setDoc+increment:", err);
        // Fallback for offline mode
        await setDoc(facRef, {
            name: facilityName.trim(),
            state: state,
            sanctions: increment(deltas.sanctionsDelta || 0),
            totalOwed: increment(deltas.amountOwedDelta || 0),
            totalPaid: increment(deltas.amountPaidDelta || 0)
        }, { merge: true });
    }
}

export async function prefetchStateRegistry(state) {
    if (!state) return;
    try {
        console.log(`[Offline Sync] Pre-fetching facilities for ${state}...`);
        const q = query(collection(db, 'facilities'), 
            where('state', '==', state),
            limit(500)
        );
        // Simply getting docs while online forces them into the IndexedDB persistence cache
        const snap = await getDocs(q);
        console.log(`[Offline Sync] ${snap.size} facilities cached locally.`);
        return snap.size;
    } catch (err) {
        console.error("[Offline Sync] Prefetch failed:", err);
    }
}

export { db, auth, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, orderBy, Timestamp, limit, runTransaction, increment };
