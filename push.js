import { auth, db, doc, setDoc, serverTimestamp } from "./db.js";
import { FCM_VAPID_KEY } from "./constants.js";
import { showToast } from "./ui.js";
import {
    getMessaging,
    getToken,
    isSupported,
    onMessage
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

let messagingInstance = null;

function tokenDocId(token) {
    return btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function canUsePushNotifications() {
    return 'Notification' in window && 'serviceWorker' in navigator && await isSupported();
}

export async function enablePhonePushNotifications(currentUserData = {}) {
    if (!auth.currentUser) throw new Error('Sign in before enabling phone alerts.');
    if (!FCM_VAPID_KEY) {
        throw new Error('Firebase Web Push key is not configured yet.');
    }

    const supported = await canUsePushNotifications();
    if (!supported) {
        throw new Error('This browser does not support web push notifications.');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error('Notification permission was not granted.');
    }

    const registration = await navigator.serviceWorker.ready;
    messagingInstance = messagingInstance || getMessaging();
    const token = await getToken(messagingInstance, {
        vapidKey: FCM_VAPID_KEY,
        serviceWorkerRegistration: registration
    });

    if (!token) throw new Error('Could not create a notification token for this device.');

    await setDoc(doc(db, 'users', auth.currentUser.uid, 'notificationTokens', tokenDocId(token)), {
        token,
        platform: 'web',
        userAgent: navigator.userAgent,
        state: currentUserData.state || '',
        zone: currentUserData.zone || '',
        role: currentUserData.role || '',
        enabled: true,
        updatedAt: serverTimestamp()
    }, { merge: true });

    localStorage.setItem('nafdacPmsPushEnabled', 'true');
    return token;
}

export async function initForegroundPushHandler() {
    if (!await canUsePushNotifications()) return;
    messagingInstance = messagingInstance || getMessaging();
    onMessage(messagingInstance, (payload) => {
        const title = payload.notification?.title || payload.data?.title || 'NAFDAC PMS Alert';
        const body = payload.notification?.body || payload.data?.body || 'New surveillance item requires attention.';
        showToast(title, body, 'warning', 8000);

        if (payload.data?.targetPage) {
            window.dispatchEvent(new CustomEvent('push-message-received', { detail: payload.data }));
        }
    });
}
