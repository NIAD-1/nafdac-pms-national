// ═══════════════════════════════════════════════════════════════
// NAFDAC PMS v2 — FIREBASE DATABASE MODULE
// ═══════════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, orderBy, Timestamp, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";

const firebaseConfig = {
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

// ── Facility Auto-Upsert ────────────────────────────────────────
export async function upsertFacility(facilityData, userState) {
    if (!facilityData.facilityName) return null;
    const name = facilityData.facilityName.trim();
    const state = userState || facilityData.state || '';

    // Search for existing facility by name + state
    const q = query(collection(db, 'facilities'),
        where('name', '==', name),
        where('state', '==', state)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
        // Create new facility
        const ref = await addDoc(collection(db, 'facilities'), {
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
        return ref.id;
    } else {
        // Update existing facility
        const existing = snap.docs[0];
        await updateDoc(doc(db, 'facilities', existing.id), {
            totalVisits: (existing.data().totalVisits || 0) + 1,
            lastVisitDate: facilityData.inspectionDate || new Date().toISOString().split('T')[0],
            lastActivity: facilityData.activityType || '',
            address: facilityData.facilityAddress || existing.data().address
        });
        return existing.id;
    }
}
export async function updateFacilityFinances(facilityName, state, deltas) {
    if (!facilityName) return;
    const q = query(collection(db, 'facilities'), where('name', '==', facilityName.trim()), where('state', '==', state));
    const snap = await getDocs(q);
    if (!snap.empty) {
        const existing = snap.docs[0];
        const d = existing.data();
        await updateDoc(doc(db, 'facilities', existing.id), {
            sanctions: (d.sanctions || 0) + (deltas.sanctionsDelta || 0),
            totalOwed: (d.totalOwed || 0) + (deltas.amountOwedDelta || 0),
            totalPaid: (d.totalPaid || 0) + (deltas.amountPaidDelta || 0)
        });
    } else {
        // If facility doesn't exist yet, we auto-create it with just the ledger
        await addDoc(collection(db, 'facilities'), {
            name: facilityName.trim(),
            state: state,
            totalVisits: 0,
            sanctions: deltas.sanctionsDelta || 0,
            totalPaid: deltas.amountPaidDelta || 0,
            totalOwed: deltas.amountOwedDelta || 0,
            createdAt: serverTimestamp()
        });
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

export { db, auth, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, orderBy, Timestamp, limit };
