// Credenziali per gli script Admin: riusa il login della Firebase CLI (`firebase login`) oppure gcloud ADC.
// Il refresh token resta in memoria: non viene mai stampato né scritto su disco.
// Si usa @google-cloud/firestore (lo stesso client di firebase-admin), che accetta credenziali
// 'authorized_user' in memoria; firebase-admin/firestore accetterebbe solo ADC o service account.
import { createRequire } from 'node:module';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';

const require = createRequire(import.meta.url);
export const PROJECT_ID = process.env.GCLOUD_PROJECT || 'garageos-879bc';
export { Timestamp, GeoPoint, DocumentReference, FieldValue, FieldPath } from '@google-cloud/firestore';

function cliCredentials() {
  try {
    const { configstore } = require('firebase-tools/lib/configstore');
    const api = require('firebase-tools/lib/api');
    const tokens = configstore.get('tokens');
    if (!tokens?.refresh_token) return null;
    return { type: 'authorized_user', client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: tokens.refresh_token };
  } catch { return null; }
}

export function adminDb() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return new Firestore({ projectId: PROJECT_ID });   // emulatore
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS ? undefined : cliCredentials();
  return new Firestore({ projectId: PROJECT_ID, ...(credentials ? { credentials } : {}) });
}

export async function accessToken() {
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS ? undefined : cliCredentials();
  const auth = new GoogleAuth({ ...(credentials ? { credentials } : {}), scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return (await (await auth.getClient()).getAccessToken()).token;
}

export function whoami() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return `EMULATORE ${process.env.FIRESTORE_EMULATOR_HOST}`;
  try { return require('firebase-tools/lib/configstore').configstore.get('user')?.email || 'ADC'; } catch { return 'ADC'; }
}
