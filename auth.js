// ═══════════════════════════════════════════════════════════════
// NAFDAC PMS v4 — AUTHENTICATION & ROLE MANAGEMENT
// Email/Password Auth with Admin-Provisioned Accounts
// ═══════════════════════════════════════════════════════════════
import { auth, db, doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp, limit } from "./db.js";
import { NAV_PERMISSIONS, ROLES } from "./constants.js";
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
    sendPasswordResetEmail,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

export let currentUser = null;
export let currentUserData = null;

export function initAuth(dbInstance, onAuthChangeCallback) {
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            console.log("Portal User Authenticated:", user.email);

            try {
                // Look up the user's Firestore profile by UID
                const userRef = doc(dbInstance, "users", user.uid);
                const docSnap = await getDoc(userRef);

                if (docSnap.exists()) {
                    currentUserData = { ...docSnap.data(), uid: user.uid };
                } else {
                    // Fallback: Check if admin pre-provisioned by email (before first login)
                    const q = query(collection(dbInstance, "users"), where("email", "==", user.email), limit(1));
                    const querySnapshot = await getDocs(q);

                    if (!querySnapshot.empty) {
                        const preProvDoc = querySnapshot.docs[0];
                        currentUserData = { ...preProvDoc.data(), uid: user.uid };

                        // Migrate: Copy the pre-provisioned doc to be keyed by UID
                        await setDoc(userRef, { ...currentUserData, uid: user.uid }, { merge: true });

                        // Clean up the old email-keyed doc if it has a different ID
                        if (preProvDoc.id !== user.uid) {
                            // We leave the old doc — it won't cause issues and avoids delete permission problems
                            console.log("[Auth] Migrated pre-provisioned profile to UID key:", user.uid);
                        }
                    } else {
                        // No profile exists at all — this email was never provisioned by an admin
                        console.warn("[Auth] ⚠️ No profile found for:", user.email, "— Access denied.");
                        currentUserData = {
                            email: user.email,
                            displayName: user.email,
                            role: "unauthorized",
                            status: "unauthorized"
                        };
                    }
                }
            } catch (err) {
                console.error("[Auth] ❌ Profile lookup failed:", err.message);
                currentUserData = {
                    email: user.email,
                    displayName: user.email,
                    role: "unauthorized",
                    status: "unauthorized"
                };
            }

            onAuthChangeCallback(user, currentUserData);
        } else {
            currentUserData = null;
            onAuthChangeCallback(null, null);
        }
    });
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

// ── EMAIL/PASSWORD AUTH ─────────────────────────────────────────

export async function signInWithEmail(email, password) {
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error("Sign-in error:", error.code);
        // Translate Firebase error codes to user-friendly messages
        const messages = {
            'auth/user-not-found': 'No account found with this email. Contact your administrator.',
            'auth/wrong-password': 'Incorrect password. Please try again.',
            'auth/invalid-credential': 'Invalid email or password. Please try again.',
            'auth/invalid-email': 'Please enter a valid email address.',
            'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
            'auth/too-many-requests': 'Too many failed attempts. Please wait a few minutes and try again.'
        };
        throw new Error(messages[error.code] || 'Sign-in failed. Please try again.');
    }
}

export async function changeUserPassword(newPassword) {
    if (!auth.currentUser) throw new Error("Not authenticated.");
    if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");
    await updatePassword(auth.currentUser, newPassword);

    // Clear the mustChangePassword flag in Firestore
    if (currentUserData) {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await setDoc(userRef, { mustChangePassword: false }, { merge: true });
        currentUserData.mustChangePassword = false;
    }
}

export async function sendPasswordReset(email) {
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error) {
        const messages = {
            'auth/user-not-found': 'No account found with this email.',
            'auth/invalid-email': 'Please enter a valid email address.'
        };
        throw new Error(messages[error.code] || 'Could not send reset email. Please try again.');
    }
}

export async function logOut() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error signing out:", error);
    }
}

// ── ADMIN: CREATE OFFICER ACCOUNT ───────────────────────────────
// Uses a secondary Firebase app instance so the admin stays logged in

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

let secondaryApp = null;
let secondaryAuth = null;

function getAdminAuthInstance() {
    if (!secondaryApp) {
        // Create a secondary Firebase app specifically for creating users
        // This prevents the admin from being signed out
        const config = {
            apiKey: "AIzaSyC98TWcj1lzG4MtOYpDGt3MxISC5JNW2Yk",
            authDomain: "pms-national.firebaseapp.com",
            projectId: "pms-national"
        };
        secondaryApp = initializeApp(config, "adminCreator");
        secondaryAuth = getSecondaryAuth(secondaryApp);
    }
    return secondaryAuth;
}

export async function createOfficerAccount(email, tempPassword, profileData) {
    const adminAuth = getAdminAuthInstance();
    try {
        // Create the Firebase Auth account
        const userCredential = await createUserWithEmailAndPassword(adminAuth, email, tempPassword);
        const newUid = userCredential.user.uid;

        // Sign out the secondary auth immediately (we don't need it logged in)
        await signOut(adminAuth);

        // Create the Firestore user profile (keyed by the new UID)
        const userProfile = {
            email: email,
            displayName: profileData.displayName || email,
            role: profileData.role || 'field_officer',
            status: 'approved', // Pre-approved by admin
            state: profileData.state || '',
            zone: profileData.zone || '',
            directorate: 'PMS',
            uid: newUid,
            mustChangePassword: true, // Force password change on first login
            createdBy: currentUserData?.email || 'admin',
            createdAt: serverTimestamp()
        };

        await setDoc(doc(db, "users", newUid), userProfile);
        console.log("[Auth] ✅ Officer account created:", email);

        // 📧 Notify the officer via EmailJS
        notifyOfficerAccountCreated(profileData.displayName || email, email);

        return newUid;
    } catch (error) {
        console.error("[Auth] ❌ Account creation failed:", error);
        const messages = {
            'auth/email-already-in-use': 'An account with this email already exists.',
            'auth/invalid-email': 'Please enter a valid email address.',
            'auth/weak-password': 'Password must be at least 6 characters.'
        };
        throw new Error(messages[error.code] || error.message);
    }
}


// ── EMAIL NOTIFICATIONS ─────────────────────────────────────────

const EMAILJS_SERVICE_ID = 'service_91zhfw3';
const EMAILJS_TEMPLATE_ID = 'template_chvc2sa';
const EMAILJS_PUBLIC_KEY = 'kCwwP4QT_OBENGN3M';

async function loadEmailJS() {
    if (!window.emailjs) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        document.head.appendChild(script);
        await new Promise(r => script.onload = r);
    }
    window.emailjs.init(EMAILJS_PUBLIC_KEY);
}

async function notifyAdminNewUser(name, email) {
    if (EMAILJS_SERVICE_ID === 'YOUR_SERVICE_ID') return;
    try {
        await loadEmailJS();
        await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
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

// ── USER APPROVAL / ACCOUNT CREATION EMAIL NOTIFICATION ─────────
const EMAILJS_USER_APPROVED_TEMPLATE_ID = 'template_vdomev4';

export async function notifyUserApproved(name, email) {
    if (EMAILJS_USER_APPROVED_TEMPLATE_ID === 'YOUR_APPROVAL_TEMPLATE_ID') return;
    try {
        await loadEmailJS();
        await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_USER_APPROVED_TEMPLATE_ID, {
            user_name: name,
            to_email: email,
            portal_url: 'https://pmsd.netlify.app/'
        });
        console.log("[Notify] 📧 User notified of approval:", email);
    } catch (err) {
        console.warn("[Notify] Approval email failed:", err?.text || err?.message || err);
    }
}

async function notifyOfficerAccountCreated(name, email) {
    try {
        await loadEmailJS();
        await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_USER_APPROVED_TEMPLATE_ID, {
            user_name: name,
            to_email: email,
            portal_url: 'https://pmsd.netlify.app/'
        });
        console.log("[Notify] 📧 Officer notified of new account:", email);
    } catch (err) {
        console.warn("[Notify] Account creation email failed:", err?.text || err?.message || err);
    }
}
