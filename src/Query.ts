
import { DocumentReference, Query as FirestoreQuery, QueryDocumentSnapshot, QuerySnapshot, Transaction, WriteBatch } from '@google-cloud/firestore';
import { DeleteOptions, GetOptions, SaveOptions, QueryData, SchemaData, PopulatedDocSnapshot, ModelConstructor, QueryPopulate, ModelData, QueryWhere, SaveParams, DeleteParams } from './types';
import { Storage } from './Metadata';
import { Converter } from './Converter';
import { constructorName, getSession, isModelInstance } from './utils';
import { Firesnap } from './Firesnap';
import { Model } from './Model';
import { ValidationError } from './Validator';

export enum Operators {
    $eq = '==',
    $ne = '!=',
    $lt = '<',
    $gt = '>',
    $lte = '<=',
    $gte = '>=',
    $in = 'in',
    $nin = 'not-in',
    $ac = 'array-contains',
    $aca = 'array-contains-any',
}

export class Query<T extends Model, GetOne extends boolean = false> {

    private model: ModelConstructor<T>;
    private getOne: boolean;
    private cache: { [x: string]: QueryDocumentSnapshot }; // TMP public for debug
    private query: QueryData;
    private path: string;

    constructor(model: ModelConstructor<T>, getOne = false, where: QueryWhere = null, path: string = null) {
        this.query = {
            fields: null,
            where: where,
            limit: getOne ? 1 : null,
            sort: null,
            populate: null,
            after: null,
            before: null,
            auth: null,
        };
        this.model = model;
        this.getOne = getOne;
        this.cache = {};
        this.path = path ? path : model.path;
    }

    /**
     * Add auth info. User id or true for admin.
     */
    auth(uid: string | boolean): Query<T, GetOne> {
        this.query.auth = uid;
        return this;
    }

    /**
     * Sort the results.
     */
    sort(fields: string | { [x: string]: 'asc' | 'desc' }): Query<T, GetOne> {
        this.query.sort = {};
        if (typeof fields == 'string') {
            const field = fields;
            fields = {};
            fields[field] = 'asc';
        }
        for (let field in fields) {
            const direction = fields[field];
            if (field === Storage.config.primaryKeyName) {
                field = '__name__';
            }
            this.query.sort[field] = direction;
        }
        return this;
    }

    /**
     * Select specific fields.
     */
    select(fields: string[] | string): Query<T, GetOne> {
        if (typeof fields === 'string') {
            fields = fields.split(',').map(field => field.trim());
        }
        this.query.fields = fields;
        return this;
    }

    /**
     * Limit the number of results.
     */
    limit(count: number): Query<T, GetOne> {
        this.query.limit = count;
        return this;
    }

    /**
     * Start the query after a specific value.
     */
    after(value: number | string | boolean | null | Model): Query<T, GetOne> {
        this.checkCursorValue(value);
        this.query.after = [value, false];
        return this;
    }

    /**
     * Start the query at the a specific value. 
     */
    startAt(value: number | string | boolean | null | Model): Query<T, GetOne> {
        this.checkCursorValue(value);
        this.query.after = [value, true];
        return this;
    }

    /**
     * End the query at the a specific value. 
     */
    endAt(value: number | string | boolean | null | Model): Query<T, GetOne> {
        this.checkCursorValue(value);
        this.query.before = [value, true];
        return this;
    }

    /**
     * End the query before a specific value.
     */
    endBefore(value: number | string | boolean | null | Model): Query<T, GetOne> {
        this.checkCursorValue(value);
        this.query.before = [value, false];
        return this;
    }

    /**
     * Populate collections & references.
     */
    populate(queries: unknown): Query<T, GetOne> {
        this.query.populate = this.formatPopulate(queries, this.model.getSchema());
        return this;
    }

    /**
     * Execute the current query.
     */
    async get(options: GetOptions = {}): Promise<GetOne extends true ? T : T[]> {
        let results: QuerySnapshot;
        const session = getSession(options) as Transaction;
        if (session) {
            results = await session.get(this.toFirestore(this.query));
        } else {
            results = await this.toFirestore(this.query).get();
        }
        if (!results.size && this.getOne) {
            return null;
        }
        let docs = results.docs as PopulatedDocSnapshot[]; 
        if (this.query.populate) {
            docs = await this.execPopulate(this.query.populate, docs, this.model.getSchema());
        }
        const models:Model[] = [];
        docs.forEach((doc, i) => {
            models[i] =Converter.fromFirestore(doc, this.model, this.query, options);
        });
        return <GetOne extends true ? T : T[]>(this.getOne ? models[0] : models);
    }

    /**
     * Update multiple documents.
     */
    async update(data: ModelData, options: SaveOptions = {}): Promise<{ updated: string[] }> {
        const params: Partial<SaveParams> = options;
        let useModel = false;
        const callbacks = Storage.getModelSpecs(this.model).callbacks;
        if (params.callbacks !== false && ['beforeSave', 'afterSave'].some(e => callbacks.includes(e))) {
            useModel = true;
        } else {
            const schema = this.model.getSchema();
            for (const field in schema) {
                if ((data[field] && (schema[field].type === 'Reference') || schema[field].unique)) {
                    useModel = true;
                    break;
                }
            }
        }
        if (useModel === false && params.validate !== false) {
            const model = new this.model({}, Storage.getFirestore().doc(`${this.path}/1`));
            Object.assign(model, data);
            model.setAuth(this.query.auth);
            const result = await model.validate();
            if (!result.valid) {
                throw new ValidationError(result.errors);
            }
            if (!Object.keys(result.data).length) {
                throw new Error('No data to save after validation');
            }
            data = Converter.toFirestore(result.data);
        }
        let session = getSession(params) as WriteBatch;
        if (!session) {
            session = Firesnap.batch(true);
            params.session = session;
        }
        params.recurring = true;
        const docIds: string[] = [];
        const results = await this.get({
            session: session.constructor.name === 'Transaction' ? session : null,
            returnAsJSON: (!useModel),
            populatePrimaryKey: true,
        });
        if (useModel) {
            for (const model of results as Model[]) {
                docIds.push(model.getId());
                Object.assign(model, data);
                await model.save(params);
            }
        } else {
            for (const doc of results as unknown[]) {
                const docId = doc[Storage.config.primaryKeyName];
                session.update(Storage.getFirestore().doc(`${this.path}/${docId}`), data);
                docIds.push(docId);
            }
        }
        if (session[Firesnap.INTERNAL_KEY]) {
            await session.commit();
            return { updated: docIds };
        }
    }

    /**
     * Delete multiple documents.
     */
    async delete(_options: DeleteOptions = {}): Promise<{ deleted: string[] }> {
        const params: Partial<DeleteParams> = _options;
        let useModel = false;
        const callbacks = Storage.getModelSpecs(this.model).callbacks;
        if (params.callbacks !== false && ['beforeDelete', 'afterDelete'].some(e => callbacks.includes(e))) {
            useModel = true;
        } else {
            const schema = this.model.getSchema();
            for (const field in schema) {
                if (schema[field].type === 'Collection') {
                    useModel = true;
                    break;
                }
            }
        }
        let session = getSession(params) as WriteBatch;
        if (!session) {
            session = Firesnap.batch(true);
            params.session = session;
        }
        params.recurring = true;
        const docIds: string[] = [];
        const results = await this.get({
            session: session.constructor.name === 'Transaction' ? session : null,
            returnAsJSON: !useModel,
            populatePrimaryKey: true,
        });
        if (useModel) {
            for (const model of results as Model[]) {
                docIds.push(model.getId());
                await model.delete(params);
            }
        } else {
            for (const data of results as unknown[]) {
                const docId = data[Storage.config.primaryKeyName];
                session.delete(Storage.getFirestore().doc(`${this.path}/${docId}`));
                docIds.push(docId);
            }
        }
        if (session[Firesnap.INTERNAL_KEY]) {
            await session.commit();
            return { deleted: docIds };
        }
    }

    /**
     * Convert Query options to a Firestore query.
     */
    private toFirestore(options: Partial<QueryData>, path: string = null): FirestoreQuery {
        let query: FirestoreQuery;
        query = Storage.getFirestore().collection(path ? path : this.path);
        if (options.where) {
            for (let field in options.where) {
                let value = options.where[field];
                if (isModelInstance(value)) {
                    value = value.getRef();
                }
                if (field === Storage.config.primaryKeyName) {
                    field = '__name__';
                }
                if (value.constructor === Object && !Array.isArray(value)) {
                    for (const operator in value as []) {
                        let val = value[operator];
                        if (isModelInstance(val)) {
                            val = val.getRef();
                        }
                        if (Operators[operator] === undefined) {
                            throw Error(`Unsupported operator '${operator}'`);
                        }
                        query = query.where(field, Operators[operator], val);
                    }
                } else {
                    query = query.where(field, '==', value);
                }
            }
        }
        if (options.limit) {
            query = query.limit(options.limit);
        }
        if (options.sort) {
            for (const field in options.sort) {
                query = query.orderBy(field, options.sort[field]);
            }
        }
        if (options.after) {
            const value: number | string | boolean | Model = options.after[0];
            if (typeof value === 'object' && value[Symbol.for('docSnap')]) {
                options.after[0] = value[Symbol.for('docSnap')];
            }
            query = options.after[1] ? query.startAt(options.after[0]) : query.startAfter(options.after[0]);
        }
        if (options.before) {
            const value: number | string | boolean | Model = options.before[0];
            if (typeof value === 'object' && value[Symbol.for('docSnap')]) {
                options.before[0] = value[Symbol.for('docSnap')];
            }
            query = options.before[1] ? query.endAt(options.before[0]) : query.endBefore(options.before[0]);
        }
        return query;
    }

    /**
     * Format populate queries recursively.
     */
    private formatPopulate(queries: unknown, schema: SchemaData): QueryPopulate {
        if (typeof queries === 'string') {
            queries = queries.split(',').map(field => field.trim());
        }
        if (Array.isArray(queries)) {
            if (!queries.every(item => typeof item === 'string')) {
                throw Error('Invalid populate value');
            }
            const object = {};
            queries.forEach(field => {
                object[field] = { fields: null };
            });
            queries = object;
        }
        for (const field in queries as Record<string, unknown>) {
            let query = queries[field];
            if (schema[field] === undefined) {
                throw new Error(`The field '${field}' is not defined in the schema`);
            }
            if ((schema[field].type !== 'Reference' && schema[field].type !== 'Collection'
                && schema[field].of !== 'Reference') // Array of Ref.
            ) {
                throw new Error(`Only Collections and References can be populated (${field})`);
            }
            if (typeof query === 'string') {
                query = (query as string).split(',').map((field: string) => field.trim());
            }
            if (Array.isArray(query)) {
                if (!query.every((item: string) => typeof item === 'string')) {
                    throw Error(`Invalid populate options for the field '${field}'`);
                }
                query = { fields: query };
            }
            if (query.fields === undefined) {
                query.fields = null;
            } else if (typeof query.fields === 'string') {
                query.fields = (query.fields as string).split(',').map((field: string) => field.trim());
            }
            // Auto add to populate ref & collection when added as a field.
            if (Array.isArray(query.fields)) {
                [...query.fields].forEach((field: string) => {
                    if (schema[field] && (schema[field].type == 'Reference' || schema[field].type == 'Collection')) {
                        if (!query.populate) {
                            query.populate = {};
                        }
                        query.populate[field] = {
                            fields: null,
                        };
                        query.fields.splice(query.fields.indexOf(field), 1);
                    }
                });
                if (!query.fields.length) {
                    query.fields = null;
                }
            }
            if (query.populate) {
                const model = schema[field].model as ModelConstructor;
                query.populate = this.formatPopulate(query.populate, model.getSchema());
            }
            queries[field] = query;
        }
        return queries as QueryPopulate;
    }

    /**
     * Populate collections & references recursively. 
     */
    private async execPopulate(queries: QueryPopulate, docs: PopulatedDocSnapshot[], schema: SchemaData) {
        const requests = [];
        const aliases = [];
        for (const field in queries) {
            const options = queries[field];
            const rules = schema[field];
            docs.forEach((doc, index) => {
                const data = doc.data();
                let promise = null;
                // Sub collection.
                if (rules.type === 'Collection') {
                    promise = this.toFirestore(options, `${doc.ref.path}/${field}`).get();
                    requests.push({ index: index, field: field, promise: promise });
                }
                // Single reference.
                else if (rules.type === 'Reference' && data[field] && data[field] instanceof DocumentReference) {
                    if (this.cache[data[field].path] !== undefined) {
                        promise = data[field].path;
                    } else {
                        promise = Storage.getFirestore().doc(data[field].path).get();
                        this.cache[data[field].path] = null;
                    }
                    requests.push({ index: index, field: field, promise: promise });
                }
                // Array of references.
                else if (rules.type === 'Array' && rules.of === 'Reference' && Array.isArray(data[field])) {
                    data[field].forEach((docRef: DocumentReference) => {
                        if (docRef instanceof DocumentReference) {
                            if (this.cache[docRef.path] !== undefined) {
                                promise = docRef.path;
                            } else {
                                promise = Storage.getFirestore().doc(docRef.path).get();
                                this.cache[docRef.path] = null;
                            }
                            requests.push({ index: index, field: field, promise: promise });
                        }
                    });
                }
                docs[index].populated = {};
            });
        }
        (await Promise.all(requests.map(req => req.promise))).forEach((result, i) => {
            const request = requests[i];
            let data: QueryDocumentSnapshot[] = null;
            switch (constructorName(result)) {
                case 'QuerySnapshot':
                    data = result.docs;
                    break;
                case 'QueryDocumentSnapshot':
                    data = [result];
                    this.cache[result.ref.path] = result;
                    break;
                case 'DocumentSnapshot':
                    // Non-existent Reference.
                    data = [];
                    break;
                case 'String':
                    aliases.push({ index: request.index, field: request.field, path: result });
                    break;
            }
            if (data) {
                // Array of references.
                if (Array.isArray(docs[request.index].populated[request.field])) {
                    data = docs[request.index].populated[request.field].concat(data);
                }
                docs[request.index].populated[request.field] = data;
            }
        });
        // Replace reference in the cache.
        aliases.forEach(alias => {
            if (Array.isArray(docs[alias.index].populated[alias.field])) {
                docs[alias.index].populated[alias.field].push(this.cache[alias.path]);
            } else {
                docs[alias.index].populated[alias.field] = [this.cache[alias.path]];
            }
        });
        // Continue populating recursively.
        const promises = [];
        for (const field in queries) {
            const model = schema[field].model as ModelConstructor;
            if (queries[field].populate) {
                for (const doc of docs) {
                    promises.push(this.execPopulate(queries[field].populate, doc.populated[field], model.getSchema()));
                }
            }
        }
        await Promise.all(promises);
        return docs;
    }

    /**
     * Check the cursor value for pagination methods.
     */
    private checkCursorValue(value: unknown) {
        if (value !== null && !['boolean', 'number', 'string'].includes(typeof value)) {
            if (!isModelInstance(value)) {
                throw new Error('Invalid cursor. Expecting boolean, number, string, null or Model');
            }
            if (!value[Symbol.for('docSnap')]) {
                throw new Error('Invalid model instance. It should come from a query.');
            }
            if (value.constructor.name != this.model.name) {
                throw new Error(`Invalid model type ${value.constructor.name}. Expecting ${this.model.name}`);
            }
        }
    }
}