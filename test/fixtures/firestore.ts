import { Firestore } from '@google-cloud/firestore';
import * as admin from 'firebase-admin';

export const initFirestore = async (): Promise<Firestore> => {
    let config: Record<string, unknown>;
    if (process.env.CREDENTIAL_PATH) {
        config = {
            credential: admin.credential.cert(process.cwd() + '/' + process.env.CREDENTIAL_PATH),
        };
    } else {
        if (!process.env.FIRESTORE_EMULATOR_HOST) {
            process.env['FIRESTORE_EMULATOR_HOST'] = 'localhost:8080';
        }
        config = {
            projectId: 'unit-tests',
        };
    }
    if (!admin.apps.length) {
        admin.initializeApp(config);
    }
    return admin.firestore();
};

