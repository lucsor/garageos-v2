// Re-export dell'Admin SDK, così i test fuori da tools/admin lo importano senza duplicare le dipendenze.
export { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
export { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
