import { GoogleAuth } from 'google-auth-library'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID!
const FCM_URL    = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL!,
      private_key:  process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  })
  const token = await (await auth.getClient()).getAccessToken()
  return token.token!
}

export const fcm = {
  sendToDevice: async (payload: { token: string; title: string; body: string; data?: Record<string, string> }) => {
    const accessToken = await getAccessToken()
    return fetch(FCM_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: payload.token,
          notification: { title: payload.title, body: payload.body },
          data: payload.data ?? {},
          apns:    { payload: { aps: { sound: 'default' } } },
          android: { notification: { sound: 'default' } },
        },
      }),
    }).then(r => r.json())
  },

  sendToTopic: async (payload: { topic: string; title: string; body: string; data?: Record<string, string> }) => {
    const accessToken = await getAccessToken()
    return fetch(FCM_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          topic: payload.topic,
          notification: { title: payload.title, body: payload.body },
          data: payload.data ?? {},
        },
      }),
    }).then(r => r.json())
  },
}
