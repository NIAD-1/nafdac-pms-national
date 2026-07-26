# Phone Push Setup on Vercel

This app uses Firebase Cloud Messaging for phone/browser push, but sends messages through a Vercel API route so the project can stay on Firebase Spark/Basic.

## Required Firebase Key

For local testing, create `local-config.js` in the project root. This file is git-ignored:

```js
window.NAFDAC_PMS_CONFIG = {
  FCM_VAPID_KEY: "YOUR_WEB_PUSH_CERTIFICATE_KEY"
};
```

For production on Vercel, create the same `local-config.js` during deployment or replace the committed fallback in `constants.js` during a build step. The VAPID key is public browser configuration, but keeping it outside the repo is fine.

Find it in Firebase Console:

Project Settings -> Cloud Messaging -> Web Push certificates

## Required Vercel Environment Variable

Create a Firebase service account:

Firebase Console -> Project Settings -> Service accounts -> Generate new private key

Then add one of these to Vercel Project Settings -> Environment Variables.

Recommended:

```txt
FIREBASE_SERVICE_ACCOUNT_BASE64
```

Its value should be the base64 version of the whole service account JSON file.

Alternative:

```txt
FIREBASE_SERVICE_ACCOUNT_JSON
```

Its value should be the raw JSON string.

## How Sending Works

- The app saves device tokens under `users/{uid}/notificationTokens`.
- When a complaint is logged, the app calls `/api/send-push`.
- When an approved watchlist item is created, the app calls `/api/send-push`.
- When HQ approves a pending nationwide item, the app calls `/api/send-push`.
- The Vercel API verifies the Firebase user ID token before sending.

## Officer Flow

Officers must open the bell panel and click `Phone Alerts` once on each device.

On iPhone, web push requires the app to be added to Home Screen before notification permission works reliably.
