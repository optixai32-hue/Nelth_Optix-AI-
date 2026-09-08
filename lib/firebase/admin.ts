import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { type Auth, getAuth as getFirebaseAuth } from 'firebase-admin/auth'
import { type Firestore, getFirestore } from 'firebase-admin/firestore'

type AdminApp = ReturnType<typeof getApp>

let adminApp: AdminApp | null = null

function resolveCredential() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  if (serviceAccount) {
    const json = JSON.parse(
      Buffer.from(serviceAccount, 'base64').toString('utf8')
    ) as Record<string, string>
    return { credential: cert(json), projectId: json.projectId }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT (base64 JSON) ' +
        'or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.'
    )
  }

  return {
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n')
    }),
    projectId
  }
}

function initAdminApp(): AdminApp {
  if (adminApp) return adminApp
  if (getApps().length > 0) {
    adminApp = getApp()
    return adminApp
  }

  const { credential, projectId } = resolveCredential()
  adminApp = initializeApp({ credential, projectId })
  // Tolerate undefined values so documents with optional fields
  // (e.g. metadata.traceId) can be written without manual cleaning.
  getFirestore(adminApp).settings({ ignoreUndefinedProperties: true })
  return adminApp
}

export function getAdminApp(): AdminApp {
  return initAdminApp()
}

export function getDb(): Firestore {
  return getFirestore(initAdminApp())
}

export function getAuth(): Auth {
  return getFirebaseAuth(initAdminApp())
}
