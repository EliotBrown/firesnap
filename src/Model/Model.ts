import { SaveOptions, DeleteOptions, SaveParams, DeleteParams, SchemaData, ModelConstructor, ModelConfigOrField, ValidationResult, ModelData, QueryWhere, DefaultFunction } from '../types';
import { DocumentReference, QueryDocumentSnapshot, Transaction, WriteBatch } from '@google-cloud/firestore';
import { Storage } from '../Metadata';
import { Converter } from '../Converter';
import { Collection } from '../Collection';
import { Document } from '../Document';
import { Validator, ValidationError } from '../Validator';
import { Query } from '../Query';
import { flattenObject, isModelInstance, expandObject, getSession, constructorName } from '../utils';
import { Firesnap } from '../Firesnap';
import { ModelHandler } from './ModelHandler';

export class Model {

    constructor(data: ModelData = {}, refOrSnap: DocumentReference | QueryDocumentSnapshot = null) {
        if (this.constructor[Symbol.for('inspecting')]) {
            return this;
        }
        const hasSnap = refOrSnap && refOrSnap.constructor.name === 'QueryDocumentSnapshot';
        if (refOrSnap && !hasSnap && !data[Storage.config.primaryKeyName]
            && Storage.config.getOptions.populatePrimaryKey
        ) {
            this[Storage.config.primaryKeyName] = refOrSnap.id;
        }
        const specs = Storage.getModelSpecs(this.constructor as ModelConstructor);
        const defaults = Object.assign({}, specs.defaults.schema, specs.defaults.instance);
        if (!refOrSnap) {
            for (const field in defaults) {
                if (data[field] === undefined) {
                    if (typeof defaults[field] === 'function') {
                        data[field] = (defaults[field] as DefaultFunction).call(this);
                    } else {
                        data[field] = defaults[field];
                    }
                }
            }
        }
        const proxy = new Proxy(this, ModelHandler);
        Object.defineProperty(this, Symbol.for('changes'), {
            value: {},
            writable: true,
        });
        Object.defineProperty(this, Symbol.for('fireRef'), {
            value: !hasSnap && refOrSnap ? refOrSnap : null,
            writable: true,
        });
        Object.defineProperty(this, Symbol.for('docId'), {
            value: null,
            writable: true,
        });
        Object.defineProperty(this, Symbol.for('docSnap'), {
            value: hasSnap ? refOrSnap : null,
            writable: true,
        });
        Object.defineProperty(this, Symbol.for('authValue'), {
            value: null,
            writable: true,
        });
        Object.defineProperty(this, Symbol.for('tracking'), {
            value: (!refOrSnap),
            writable: true,
        });
        if (Object.keys(data).length > 0) {
            Object.assign(proxy, data);
        }
        Object.defineProperty(this, Symbol.for('skipDef'), {
            value: { ...specs.defaults.instance },
            writable: true,
        });
        proxy[Symbol.for('tracking')] = true;
        return proxy;
    }

    /**
     * Definition of the model schema (Vanilla JS).
     */
    static schema = null;

    /**
     * Definition of the model config (Vanilla JS).
     */
    static config = null;

    /**
     * Return the model schema.
     */
    static getSchema(): SchemaData {
        let schema = Storage.getModelSchema(this);
        if (!schema && typeof this.schema === 'object') {
            Storage.setModelSchema(this, this.schema);
            schema = Storage.getModelSchema(this);
            this.schema = null;
        }
        if (schema === null) {
            schema = {};
        }
        return schema;
    }

    /**
     * Return the model config.
     */
    static getConfig<T extends string | null>(field?: T): ModelConfigOrField<T> {
        let config = Storage.getModelSpecs(this).config;
        if (!config) {
            Storage.setModelConfig(this, {});
            config = Storage.getModelSpecs(this).config;
        }
        return typeof field === 'string' ? config[field as string] : config;
    }

    /**
     * Return the collection path.
     */
    static get path(): string {
        return this.getConfig('path');
    }

    /**
     * Return the collection instance used by the model.
     */
    static collection<T extends Model>(this: ModelConstructor<T>): Collection<T> {
        let collection = Storage.getCollection(this);
        if (!collection) {
            collection = new Collection(this);
            Storage.setCollection(this, collection);
        }
        return collection;
    }

    /**
     * Return a new Query instance.
     */
    static find<T extends Model>(this: ModelConstructor<T>, conditions: QueryWhere = {}): Query<T> {
        return this.collection<T>().find(conditions);
    }

    /**
     * Return a new Query instance (single document).
     */
    static findOne<T extends Model>(this: ModelConstructor<T>, conditions: QueryWhere = {}): Query<T, true> {
        return this.collection<T>().findOne(conditions);
    }

    /**
     * Create a new document.
     */
    static create<T extends Model>(this: ModelConstructor<T>, data: ModelData, options: SaveOptions = {}): Promise<T> {
        return this.collection<T>().add(data, options);
    }

    /**
     * Return a document reference.
     */
    static doc<T extends Model>(this: ModelConstructor<T>, id: string): Document<T> {
        return this.collection<T>().doc(id);
    }

    /**
     * Return a document reference as a model instance.
     */
    static ref<T>(this: ModelConstructor<T>, id: string): T {
        const docRef = this.collection().doc(id).fireRef();
        return new this({}, docRef);
    }

    /**
     * Save the model instance data.
     */
    async save(options: SaveOptions = {}): Promise<boolean> {

        const params: SaveParams = Object.assign({
            callbacks: true,
            validate: true,
            overwrite: false,
            session: null,
            recurring: false,
            parentRef: null,
            fieldName: null,
        }, options);
        const exists = (this.getRef() !== null);
        let data = {};
        let requests = [];

        // Before save callback.
        if (params.callbacks === true || params.callbacks === 'afterSave') {
            if ((await this.beforeSave()) === false) {
                return false;
            }
        }

        // Check the session (must be before validate).
        let session = getSession(params) as WriteBatch;
        if (!session) {
            session = Firesnap.batch(true);
        }

        // Validate & sanitize data.
        if (params.validate !== false) {
            const transaction = session.constructor.name === 'Transaction' ? session : null;
            const result = await this.validate(transaction as unknown as Transaction);
            if (!result.valid) {
                throw new ValidationError(result.errors);
            }
            data = result.data;
        } else {
            for (const key in this[Symbol.for('changes')]) {
                data[key] = this[Symbol.for('changes')][key];
            }
        }

        // Save updated/created references.
        const recParams = Object.assign({}, params, { recurring: true, session: session });
        const flatData = flattenObject(this as ModelData, false, '__SEP__');
        for (const path in flatData) {
            const value = flatData[path];
            if (isModelInstance(value)) {
                if (value.getRef() && !Object.keys(value[Symbol.for('changes')]).length) {
                    requests.push({ path: path, value: value, promise: true });
                } else {
                    requests.push({ path: path, value: value, promise: value.save(recParams) });
                }
            }
            delete flatData[path];
        }
        (await Promise.all(requests.map(req => req.promise))).forEach((result, i) => {
            const request = requests[i];
            const docRef = request.value.getRef();
            flatData[request.path] = new Document(request.value.constructor, docRef.path);
        });
        if (requests.length) {
            Object.assign(data, expandObject(flatData, '__SEP__'));
        }

        // Save the document.
        const fireData = Converter.toFirestore(data);
        if (Object.keys(fireData).length) {
            if (exists) {
                /**
                 * Note: We use the actual update() method vs {merge: true} to trigger 
                 * an error when a user tries to update a document that doesn't exists. 
                 */
                if (params.overwrite === false) {
                    session.update(this.getRef(), fireData);
                } else {
                    session.set(this.getRef(), fireData);
                }
            } else {
                const constructor = this.constructor as ModelConstructor;
                const path = params.parentRef ? params.parentRef.path + '/' + params.fieldName : constructor.path;
                const docId = this[Symbol.for('docId')];
                let docRef: DocumentReference;
                if (docId) {
                    docRef = Storage.getFirestore().collection(path).doc(docId);
                } else {
                    docRef = Storage.getFirestore().collection(path).doc();
                }
                session.set(docRef, fireData);
                this[Symbol.for('fireRef')] = docRef;
            }
        } else {
            return false;
        }

        // Save sub-collections.
        requests = [];
        Object.keys(this).forEach(field => {
            if (constructorName(this[field]) === 'Collection') {
                const collection = this[field];
                for (const i in collection.deleted) {
                    /**
                     * With batches, we don't know if the item will be deleted for sure,
                     * so we can't unset it. Instead we unset it the next time there is a save.  
                     */
                    if (!collection.deleted[i].getRef()) {
                        collection.deleted.splice(i, 1);
                    } else {
                        requests.push(collection.deleted[i].delete(recParams));
                    }
                }
                for (const model of collection) {
                    if (Object.keys(model[Symbol.for('changes')]).length) {
                        requests.push(model.save(Object.assign({}, recParams, {
                            parentRef: this.getRef(),
                            fieldName: field,
                        })));
                    }
                }
            }
        });
        await Promise.all(requests);

        // After save callback
        if (params.callbacks === true || params.callbacks === 'afterSave') {
            Storage.storeCallback(session[Firesnap.SESSION_KEY], this, 'afterSave', [!exists]);
        }

        // Commit internal session. 
        if (!params.recurring && session[Firesnap.INTERNAL_KEY]) {
            await session.commit();
            this.resetChanges();
        } else {
            Storage.storeCallback(session[Firesnap.SESSION_KEY], this, 'resetChanges');
        }

        // Auto set the id for reference.
        if (!exists && Storage.config.getOptions.populatePrimaryKey) {
            this[Symbol.for('tracking')] = false;
            this[Storage.config.primaryKeyName] = this.getId();
            this[Symbol.for('tracking')] = true;
        }
        return true;
    }

    /**
     * Delete the document associated with the model instance.
     */
    async delete(options: DeleteOptions = {}): Promise<boolean> {

        const params: DeleteParams = Object.assign({
            callbacks: true,
            session: null,
            recurring: false,
        }, options);

        // Before delete callback.
        if (params.callbacks === true || params.callbacks === 'beforeDelete') {
            if ((await this.beforeDelete()) === false) {
                return false;
            }
        }

        // Bypass new documents.
        if (!this.getRef()) {
            return false;
        }

        // Check the session.
        let session = getSession(params) as WriteBatch;
        if (!session) {
            session = Firesnap.batch(true);
        }

        // Delete sub-collections.
        const requests = [];
        const collections = await this.getRef().listCollections();
        for (const collection of collections) {
            requests.push(Collection.delete(collection.path, {
                session: session,
                recurring: true,
            }));
        }
        await Promise.all(requests);

        // Delete the document. 
        session.delete(this.getRef());

        // After delete callback.
        if (params.callbacks === true || params.callbacks === 'afterDelete') {
            Storage.storeCallback(session[Firesnap.SESSION_KEY], this, 'afterDelete');
        }

        // Commit internal session (recurring can be set in Query). 
        if (session[Firesnap.INTERNAL_KEY] && !params.recurring) {
            await session.commit();
            this.resetProperties();
        } else {
            Storage.storeCallback(session[Firesnap.SESSION_KEY], this, 'resetProperties');
        }
        return true;
    }

    /**
     * Return validation results of the model data. 
     */
    async validate(session: Transaction = null): Promise<ValidationResult> {
        const constructor = this.constructor as ModelConstructor;
        const schema = constructor.getSchema();
        const newDocument = (this.getRef() === null);
        const data = {};
        for (const key in this[Symbol.for('changes')]) {
            data[key] = this[Symbol.for('changes')][key];
        }
        const result = await Validator.check(schema, data, {
            ownerField: constructor.getConfig('ownerField'),
            newDocument: newDocument,
            authValue: this[Symbol.for('authValue')],
        });
        // Check the unique rule (separated from Validator voluntarily).
        for (const field in schema) {
            if (schema[field].unique !== undefined && data[field] && !result.errors[field]) {
                const constraint = Validator.constraint(schema[field].unique, `This ${field} is already taken`);
                if (constraint.value !== true) {
                    continue;
                }
                const conditions = {};
                conditions[field] = data[field];
                if (!newDocument) {
                    conditions['__name__'] = { $ne: this.getId() };
                }
                const items = await constructor.find(conditions).limit(1).get({ session: session });
                if (items.length) {
                    result.errors[field] = constraint.message;
                    result.valid = false;
                }
            }
        }
        return result;
    }

    /**
     * Return the Firestore document reference. 
     */
    getRef(): DocumentReference {
        if (this[Symbol.for('docSnap')]) {
            return this[Symbol.for('docSnap')].ref;
        }
        return this[Symbol.for('fireRef')];
    }

    /**
     * Return the document Id. 
     */
    getId(): string {
        return this.getRef() ? this.getRef().id : this[Symbol.for('docId')];
    }

    /**
     * Set the Id for a new document. 
     */
    setId<T>(this: T, id: string): T {
        this[Symbol.for('docId')] = id;
        return this;
    }

    /**
     * Set the user auth for the current instance.
     */
    setAuth<T>(this: T, uid: string | boolean): T {
        this[Symbol.for('authValue')] = uid;
        return this;
    }

    /**
     * Return the model data as a plain JSON object.
     */
    toData(): Record<string, unknown> {
        return JSON.parse(JSON.stringify(this));
    }

    private resetChanges() {
        this[Symbol.for('changes')] = {};
    }

    private resetProperties() {
        Object.getOwnPropertySymbols(this).forEach(symbol => {
            this[symbol] = null;
        });
        Object.getOwnPropertyNames(this).forEach(prop => {
            delete this[prop];
        });
        this[Symbol.for('changes')] = {};
        this[Symbol.for('default')] = {};
        this[Symbol.for('tracking')] = true;
        return true;
    }

    protected async beforeSave(): Promise<boolean> {
        return true;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected async afterSave(created: boolean): Promise<void> {
        // Empty
    }

    protected async beforeDelete(): Promise<boolean> {
        return true;
    }

    protected async afterDelete(): Promise<void> {
        // Empty
    }
}
