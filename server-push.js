import { auth } from "./db.js";

export async function triggerServerPush(kind, id) {
    if (!auth.currentUser || !kind || !id) return { skipped: true };

    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/send-push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ kind, id })
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Push request failed');
    return payload;
}
