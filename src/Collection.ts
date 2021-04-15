
import { CollectionReference, WriteBatch } from '@google-cloud/firestore';
import { Document } from './Document';
import { Query } from './Query';
import { Storage } from './Metadata';
import { DeleteOptions, ModelConstructor, ModelData, QueryWhere, SaveOptions, SaveParams } from './types';
import { Firesnap } from './Firesnap';
import { constructorName, isModelInstance } from './utils';
import { Model } from './Model';

export class Collection<T extends Model> extends Array {

    public path: string;
    public model: ModelConstructor<T>;
    public deleted: Model[];


    constructor(model: ModelConstructor<T>, path: string = null, docs: ModelData[] = null) {
        super();
        if (docs && docs.length) {
            docs.forEach(data => {
                this.push(new model(data, null));
            });
        }
        Object.defineProperty(this, 'model', {
            value: model,
        });
        Object.defineProperty(this, 'deleted', {
            value: [],
            writable: true,
        });
        Object.defineProperty(this, 'path', {
            value: path ? path : model.path,
        });
        // Keep track of deleted documents. 
        const proxy = new Proxy(this, {
            deleteProperty(target: Collection<T>, prop: string) {
                if (target[prop].getRef()) {
                    target.deleted.push(target[prop]);
                }
                target.splice(prop as unknown as number, 1);
                return true;
            },
            defineProperty(target: Collection<T>, prop: string, descriptor) {
                if (typeof prop !== 'string' || isNaN(parseInt(prop)) || (!target[prop] && isModelInstance(descriptor.value))) {
                    return Reflect.defineProperty(target, prop, descriptor);
                }
                // We only set modelInstance here to avoid the check on most props (symbols, length, etc..)
                const modelInstance = isModelInstance(descriptor.value);
                if (!modelInstance && (!descriptor.value || descriptor.value.constructor !== Object)) {
                    const type = constructorName(descriptor.value);
                    throw Error(`Invalid value type '${type}'. Expecting Object or Model instance`);
                }
                // Replacing a previously saved model.
                if (target[prop] && isModelInstance(target[prop]) && target[prop].getId()) {
                    target.deleted.push(target[prop]);
                }
                if (!modelInstance) {
                    // Note: Prevent 'chai-subset' comparison failure (Array.prototype.slice.call())
                    /* istanbul ignore else */
                    if (typeof model !== 'number') {
                        descriptor.value = new target.model(descriptor.value, null);
                    }
                }
                return Reflect.defineProperty(target, prop, descriptor);
            },
        });
        return proxy;
    }

    async add(data: ModelData, options: SaveOptions = {}): Promise<T> {
        const model = new this.model(data);
        const params: Partial<SaveParams> = options;
        if (this.path.indexOf('/') > 0) {
            const paths = this.path.split('/');
            const field = paths.pop();
            params.parentRef = Storage.getFirestore().doc(paths.join('/'));
            params.fieldName = field;
        }
        await model.save(params);
        return model;
    }

    find(conditions = {}): Query<T> {
        return new Query(this.model, false, conditions, this.path);
    }

    findOne(conditions: QueryWhere = {}): Query<T, true> {
        return new Query(this.model, true, conditions, this.path);
    }

    doc(id: string): Document<T> {
        return new Document<T>(this.model, id, this.path);
    }

    /**
     * Delete sub-collections recursively.
     */
    static async delete(path: string, options: DeleteOptions & { recurring?: true } = {}): Promise<void> {
        if (path.indexOf('/') < 1) {
            throw new Error('Only sub-collections can be deleted');
        }
        let session = options.session as WriteBatch;
        if (!session) {
            session = Firesnap.batch(true);
        }
        const results = await Storage.firestore.collection(path).get();
        const colReqs = [];
        for (const doc of results.docs) {
            colReqs.push(doc.ref.listCollections());
            session.delete(doc.ref);
        }
        const delReqs = [];
        await Promise.all(colReqs).then(results => {
            results.forEach((collections: CollectionReference[]) => {
                collections.forEach(col => {
                    delReqs.push(Collection.delete(col.path, {
                        session: session,
                        recurring: true,
                    }));
                });
            });
        });
        await Promise.all(delReqs);
        if (session[Firesnap.INTERNAL_KEY] && !options.recurring) {
            await session.commit();
        }
    }

    /**
     * Delete the current sub-collection.
     */
    async delete(options: DeleteOptions = {}): Promise<void> {
        await Collection.delete(this.path, options);
    }
}
