const admin = require("firebase-admin");

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const required = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
  if (required.every((key) => process.env[key])) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    };
  }
  throw new Error("Firebase Admin credentials are not configured.");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(getServiceAccount())
  });
}

const db = admin.firestore();

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function verifyRequester(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw Object.assign(new Error("Missing auth token."), { statusCode: 401 });

  const decoded = await admin.auth().verifyIdToken(match[1]);
  const userDoc = await db.collection("users").doc(decoded.uid).get();
  if (!userDoc.exists) throw Object.assign(new Error("User profile not found."), { statusCode: 403 });

  const user = { uid: decoded.uid, ...userDoc.data() };
  if (user.status !== "approved" && !["admin", "national_admin"].includes(user.role)) {
    throw Object.assign(new Error("User is not approved."), { statusCode: 403 });
  }
  return user;
}

async function getTargetUsers(target) {
  if (target.scope === "nationwide") {
    const snap = await db.collection("users").where("status", "==", "approved").get();
    return snap.docs;
  }

  if (target.scope === "selected_states" && target.targetStates?.length) {
    const docs = [];
    for (const states of chunk(target.targetStates, 10)) {
      const snap = await db.collection("users")
        .where("status", "==", "approved")
        .where("state", "in", states)
        .get();
      docs.push(...snap.docs);
    }
    return docs;
  }

  if (target.scope === "zone" && target.zone) {
    const snap = await db.collection("users")
      .where("status", "==", "approved")
      .where("zone", "==", target.zone)
      .get();
    return snap.docs;
  }

  if (target.state) {
    const snap = await db.collection("users")
      .where("status", "==", "approved")
      .where("state", "==", target.state)
      .get();
    return snap.docs;
  }

  return [];
}

async function collectTokens(userDocs) {
  const tokenSet = new Set();
  await Promise.all(userDocs.map(async (userDoc) => {
    const snap = await userDoc.ref.collection("notificationTokens").where("enabled", "==", true).get();
    snap.docs.forEach((tokenDoc) => {
      const token = tokenDoc.data().token;
      if (token) tokenSet.add(token);
    });
  }));
  return [...tokenSet];
}

async function sendToTokens(tokens, payload) {
  let success = 0;
  let failure = 0;
  for (const tokenBatch of chunk(tokens, 500)) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: tokenBatch,
      notification: payload.notification,
      data: payload.data,
      webpush: {
        fcmOptions: {
          link: payload.link || "/"
        }
      }
    });
    success += res.successCount;
    failure += res.failureCount;
  }
  return { success, failure };
}

function roleLevel(role) {
  return {
    field_officer: 1,
    inspector: 1,
    state_coordinator: 2,
    zonal_coordinator: 3,
    admin: 4,
    national_admin: 4
  }[role] || 0;
}

async function pushWatchlist(id, requester) {
  const docSnap = await db.collection("alerts").doc(id).get();
  if (!docSnap.exists) throw Object.assign(new Error("Watchlist item not found."), { statusCode: 404 });
  const item = docSnap.data();

  if (item.approvalStatus && item.approvalStatus !== "approved") {
    return { skipped: true, reason: "Watchlist item is not approved yet." };
  }
  if (roleLevel(requester.role) < 2) {
    throw Object.assign(new Error("Not allowed to broadcast watchlist items."), { statusCode: 403 });
  }

  const scope = item.scope || "nationwide";
  const userDocs = await getTargetUsers({
    scope,
    state: item.state,
    zone: item.zone,
    targetStates: item.targetStates || []
  });
  const tokens = await collectTokens(userDocs);
  if (!tokens.length) return { skipped: true, reason: "No enabled device tokens found.", recipients: userDocs.length };

  const typeLabel = {
    product_alert: "Product Alert",
    recall: "Recall",
    advert_watch: "Advert Watch",
    rasff: "RASFF Notice"
  }[item.itemType] || "Watchlist Item";

  const result = await sendToTokens(tokens, {
    notification: {
      title: scope === "nationwide" ? `New National ${typeLabel}` : `New ${typeLabel}`,
      body: `${item.productName || "Watchlist item"}: ${item.reason || "Review field instructions."}`
    },
    data: {
      type: "alert",
      targetPage: "alerts",
      targetId: id,
      title: `New ${typeLabel}`,
      body: item.productName || "Review the latest watchlist item."
    },
    link: "/?pushTarget=alerts"
  });

  await db.collection("alerts").doc(id).set({
    lastPushAt: admin.firestore.FieldValue.serverTimestamp(),
    lastPushBy: requester.uid,
    lastPushSuccess: result.success,
    lastPushFailure: result.failure
  }, { merge: true });

  return { ...result, recipients: userDocs.length };
}

async function pushComplaint(id) {
  const docSnap = await db.collection("complaints").doc(id).get();
  if (!docSnap.exists) throw Object.assign(new Error("Complaint not found."), { statusCode: 404 });
  const complaint = docSnap.data();

  const userDocs = await getTargetUsers({
    scope: "state",
    state: complaint.state,
    zone: complaint.zone
  });
  const tokens = await collectTokens(userDocs);
  if (!tokens.length) return { skipped: true, reason: "No enabled device tokens found.", recipients: userDocs.length };

  const result = await sendToTokens(tokens, {
    notification: {
      title: "New Complaint Assigned",
      body: `${complaint.productName || "Consumer complaint"} needs response in ${complaint.state || "your state"}.`
    },
    data: {
      type: "complaint",
      targetPage: "log-complaints",
      targetId: id,
      title: "New Complaint Assigned",
      body: complaint.productName || "Consumer complaint needs response."
    },
    link: `/?pushTarget=log-complaints&targetId=${encodeURIComponent(id)}`
  });

  return { ...result, recipients: userDocs.length };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const requester = await verifyRequester(req);
    const { kind, id } = req.body || {};
    if (!kind || !id) return res.status(400).json({ error: "kind and id are required" });

    const result = kind === "complaint"
      ? await pushComplaint(id, requester)
      : kind === "watchlist"
        ? await pushWatchlist(id, requester)
        : null;

    if (!result) return res.status(400).json({ error: "Unsupported push kind" });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Push failed" });
  }
};
