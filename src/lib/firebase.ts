import { ENV } from '@/env'
import * as admin from 'firebase-admin'

let app: admin.app.App | null = null

export function getFirebaseApp() {
    if (app) return app
    if (ENV.FIREBASE_PROJECT_ID && ENV.FIREBASE_CLIENT_EMAIL && ENV.FIREBASE_PRIVATE_KEY) {
        app = admin.initializeApp({
            credential: admin.credential.cert({
                projectId: ENV.FIREBASE_PROJECT_ID,
                clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
                privateKey: ENV.FIREBASE_PRIVATE_KEY
            }),
            databaseURL: `https://${ENV.FIREBASE_PROJECT_ID}.firebaseio.com`
        })
    }
    return app
}

export function getRealtimeDb() {
    const a = getFirebaseApp()
    return a ? admin.database() : null
}
