import { DocumentReference } from '@google-cloud/firestore';
import { Storage } from './Metadata';
import { Query } from './Query';
import { Collection } from './Collection';
import { DeleteOptions, GetOptions, ModelConstructor, ModelData, SaveOptions } from './types';
import { Model } from './Model';

export class Document<T extends Model> {

    private model: ModelConstructor<T>;
    private id: string;
    private path: string;
    private _auth: string | boolean;
    private _query: Query<T, true>;

    constructor(model: ModelConstructor<T>, id: string, path: string = null) {
        if (typeof id !== 'string' || id.length < 1) {
            throw new Error(`Invalid id '${id}' for Document reference of type '${model.name}'`);
        }
        if (id.indexOf('/') > -1) {
            const paths = id.split('/');
            id = paths.pop();
            path = paths.join('/');
        }
        this.model = model;
        this.path = path !== null ? path : model.path;
        this.id = id;
        this._query = null;
        this._auth = null;
    }


    private get query() {
        if (!this._query) {
            this._query = new Query<T, true>(this.model, true, {
                __name__: this.id,
            });
        }
        this._query.auth(this._auth);
        return this._query as Query<T, true>;
    }

    /**
     * Return Firestore document reference.
     */
    fireRef(): DocumentReference {
        return Storage.getFirestore().collection(this.path).doc(this.id);
    }

    /**
     * Set the auth.
     * @param uid User Id or true for admin 
     */
    auth(uid: string | boolean): Document<T> {
        this._auth = uid;
        return this;
    }

    /**
     * Select specific fields.
     */
    select(fields: string[] | string): Query<T, true> {
        return this.query.select(fields);
    }

    /**
     * Populate collections & references.
     */
    populate(fields: unknown): Query<T, true> {
        return this.query.populate(fields);
    }

    /**
     * Return a sub-collection. 
     */
    collection(name: string): Collection<T> {
        const schema = this.model.getSchema();
        if (schema[name] === undefined) {
            throw Error(`Field ${name} is not defined in the schema`);
        }
        if (schema[name].type !== 'Collection') {
            throw Error(`Field ${name} is not defined as a Collection in the schema`);
        }
        return new Collection(schema[name].model as ModelConstructor<T>, `${this.path}/${this.id}/${name}`);
    }

    /**
     * Load the document and return a model instance.
     */
    async get(options: GetOptions = {}): Promise<T> {
        return this.query.get(options);
    }

    /**
     * Update the current document. 
     */
    async update(data: ModelData, options: SaveOptions = {}): Promise<boolean> {
        const model = new this.model({}, this.fireRef());
        Object.assign(model, data);
        model.setAuth(this._auth);
        return await model.save(Object.assign(options, { overwrite: false }));
    }

    /**
     * Delete the current document. 
     */
    async delete(options: DeleteOptions = {}): Promise<boolean> {
        const model = new this.model({}, this.fireRef());
        return await model.delete(options);
    }

    /**
     * Overwrite the current document.
     */
    async set(data: ModelData, options: SaveOptions & { merge?: boolean } = {}): Promise<boolean> {
        if (options.merge) {
            return this.update(data, options);
        }
        const model = new this.model({}, this.fireRef());
        Object.assign(model, data);
        model.setAuth(this._auth);
        return await model.save(Object.assign(options, { overwrite: true }));
    }

}