
import { Firestore, WriteBatch, Transaction, WriteResult } from '@google-cloud/firestore';
import { Storage } from './Metadata';
import { ConfigOptions } from './types';

export class Firesnap {

    /**
     * Set as a variable for unit tests. 
     */
    public static callbackTimeout = 10000;

    /**
     * Key used to store the session Id. 
     */
    public static readonly SESSION_KEY = 'sessId';

    /**
     * Flag to dissociate internal vs user batches.
     */
    public static readonly INTERNAL_KEY = 'internal';

    /**
     * Initialize Firesnap. 
     */
    static initialize(firestore: Firestore, config: ConfigOptions = {}): void {
        if (firestore.constructor.name !== 'Firestore') {
            throw new Error('1st argument must be a Firestore instance');
        }
        Storage.firestore = firestore;
        for (const prop in config) {
            if (config[prop] instanceof Object) {
                Object.assign(Storage.config[prop], config[prop]);
            } else {
                Storage.config[prop] = config[prop];
            }
        }
    }

    /**
     * Create a new batch.
     */
    static batch(internal = false): WriteBatch {
        const batch = Storage.getFirestore().batch();
        const sessId = Storage.getFirestore().collection('_').doc().id;
        Object.defineProperty(batch, this.SESSION_KEY, {
            value: sessId,
        });
        Object.defineProperty(batch, this.INTERNAL_KEY, {
            value: internal,
        });
        const timer = setTimeout(() => Storage.clearCallbacks(sessId), this.callbackTimeout);
        return new Proxy(batch, {
            get(target: WriteBatch, prop: string) {
                if (prop == 'commit') {
                    clearTimeout(timer);
                    return (async () => {
                        let result: WriteResult[];
                        let error: Error;
                        try {
                            result = await target[prop]();
                            const promises = [];
                            Storage.getCallbacks(sessId).forEach(cb => {
                                promises.push(cb.model[cb.method](...cb.args));
                            });
                            await Promise.all(promises);
                        } catch (e) {
                            error = e;
                        }
                        Storage.clearCallbacks(sessId);
                        if (error) {
                            throw error;
                        }
                        return result;
                    });
                }
                return target[prop];
            },
        });
    }

    /**
     * Execute a new transaction.
     */
    // eslint-disable-next-line no-unused-vars
    static async transaction(executor: (txn: Transaction) => Promise<void>): Promise<void> {
        await Storage.getFirestore().runTransaction(async txn => {
            const sessId = Storage.getFirestore().collection('_').doc().id;
            Object.defineProperty(txn, this.SESSION_KEY, {
                value: sessId,
            });
            let error: Error;
            try {
                await executor(txn);
                Storage.getCallbacks(sessId).forEach(cb => {
                    cb.model[cb.method](...cb.args);
                });
            } catch (e) {
                error = e;
            }
            Storage.clearCallbacks(sessId);
            if (error) {
                throw error;
            }
        });
    }
}