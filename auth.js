// ═══════════════════════════════════════════════════════════════
// NAFDAC PMS v2 — AUTHENTICATION & ROLE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
import { auth, db, doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp, limit } from "./db.js";
import { NAV_PERMISSIONS, ROLES } from "./constants.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const googleProvider = new GoogleAuthProvider();

export let currentUser = null;
export let currentUserData = null;

export function initAuth(dbInstance, onAuthChangeCallback) {
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            console.log("Portal User Authenticated:", user.email);

            try {
                // Step 1: Check if user was pre-provisioned by admin (email lookup)
                // MUST have limit(1) to comply with Firestore security rules
                const q = query(collection(dbInstance, "users"), where("email", "==", user.email), limit(1));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    // User was pre-provisioned by an admin
                    const docSnap = querySnapshot.docs[0];
                    currentUserData = { ...docSnap.data(), uid: user.uid };
                    // ONLY UPDATE THE DATABASE IF ADMIN (Phase 15 Strict Rules)
                    if (currentUserData.role === 'admin' || currentUserData.role === 'national_admin') {
                        await setDoc(doc(dbInstance, "users", docSnap.id), { uid: user.uid }, { merge: true });
                    }
                } else {
                    // No pre-provisioned doc found — create new user profile
                    await createNewUserProfile(dbInstance, user);
                }
            } catch (emailLookupErr) {
                // Email query was blocked by security rules — fall through to direct UID approach
                console.warn("[Auth] Email lookup blocked, trying direct UID approach:", emailLookupErr.message);
                await createNewUserProfile(dbInstance, user);
            }

            onAuthChangeCallback(user, currentUserData);
        } else {
            currentUserData = null;
            onAuthChangeCallback(null, null);
        }
    });
}

async function createNewUserProfile(dbInstance, user) {
    const userRef = doc(dbInstance, "users", user.uid);
    try {
        const docSnap = await getDoc(userRef);
        if (!docSnap.exists()) {
            currentUserData = {
                email: user.email,
                displayName: user.displayName || user.email,
                role: "pending",
                status: "pending",
                state: "",
                zone: "",
                directorate: "PMS",
                uid: user.uid,
                createdAt: serverTimestamp()
            };
            await setDoc(userRef, currentUserData);
            console.log("[Auth] ✅ New user profile created in Firestore:", user.email);

            // 📧 Notify Admin via EmailJS (fire-and-forget)
            notifyAdminNewUser(user.displayName || user.email, user.email);
        } else {
            currentUserData = { ...docSnap.data(), uid: user.uid };
        }
    } catch (err) {
        console.error("[Auth] ❌ Failed to create user profile:", err.message);
        // Provide minimal fallback data so the app doesn't crash
        currentUserData = {
            email: user.email,
            displayName: user.displayName || user.email,
            role: "pending",
            status: "pending"
        };
    }
}

/** Apply role-based navigation visibility */
export function applyRoleNav(role) {
    const allowed = NAV_PERMISSIONS[role] || NAV_PERMISSIONS.field_officer;

    // Hide/show nav buttons and their section labels
    document.querySelectorAll('[data-nav]').forEach(el => {
        const navKey = el.dataset.nav;
        el.style.display = allowed.includes(navKey) ? '' : 'none';
    });

    // Hide section labels if all their buttons are hidden
    document.querySelectorAll('[data-nav-section]').forEach(label => {
        const sectionKey = label.dataset.navSection;
        // Check if any nav button in this section is visible
        const nextSibling = label.nextElementSibling;
        if (nextSibling) {
            const visibleButtons = nextSibling.querySelectorAll('[data-nav]');
            let anyVisible = false;
            visibleButtons.forEach(btn => {
                if (allowed.includes(btn.dataset.nav)) anyVisible = true;
            });
            label.style.display = anyVisible ? '' : 'none';
        }
    });
}

/** Check if user can access a page */
export function canAccessPage(role, page) {
    const allowed = NAV_PERMISSIONS[role] || NAV_PERMISSIONS.field_officer;
    return allowed.includes(page);
}

/** Get state-scoped filter for queries */
export function getUserScope() {
    if (!currentUserData) return {};
    const role = currentUserData.role;
    const level = ROLES[role]?.level || 1;

    if (level >= 4) return {}; // Director sees everything
    if (level >= 3) return { zone: currentUserData.zone }; // Zonal
    return { state: currentUserData.state }; // State + Officer
}

export async function signInWithGoogle() {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error("Error signing in:", error);
        alert(error.message);
    }
}

export async function logOut() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error signing out:", error);
    }
}


const EMAILJS_SERVICE_ID = 'service_91zhfw3';
const EMAILJS_TEMPLATE_ID = 'template_chvc2sa';
const EMAILJS_PUBLIC_KEY = 'kCwwP4QT_OBENGN3M';

async function notifyAdminNewUser(name, email) {
    if (EMAILJS_SERVICE_ID === 'YOUR_SERVICE_ID') {
        console.log("[Notify] EmailJS not configured. Skipping admin email notification.");
        return;
    }
    try {
        if (!window.emailjs) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
            document.head.appendChild(script);
            await new Promise(r => script.onload = r);
        }
        window.emailjs.init(EMAILJS_PUBLIC_KEY);
        await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            // Send all possible variable names to match any template format
            user_name: name,
            user_email: email,
            email: email,
            name: name,
            time: new Date().toLocaleString(),
            to_email: 'enilamaoshoriamhe687@gmail.com'
        });
        console.log("[Notify] 📧 Admin notified of new user:", email);
    } catch (err) {
        console.warn("[Notify] Email notification failed:", err?.text || err?.message || err);
    }
}
