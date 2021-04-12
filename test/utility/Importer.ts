/**
 * Minimalist helper to insert data, primarily use for for integration tests.
 */
import { DocumentReference, Firestore, Timestamp, GeoPoint, WriteResult } from '@google-cloud/firestore';
import { readFileSync } from 'fs';

type ImportConfig = {
    autoId: boolean,
    prefix: string | false,
    idField: string | false,
    types: {
        reference?: string[],
        geopoint?: string[],
        date?: string[],
        timestamp?: string[],
        collection?: string[],
    },
}
type FieldValue = { [x: string]: FieldValue } | FieldValue[] | string | number | null;
type FireValue = FieldValue & DocumentReference & Timestamp & FireValue[];
type Collection = Record<number, Document>;
type Document = Record<string, FieldValue>;
type FormattedData = Record<string, Record<string, FireValue>>;

export class Importer {

    public documents: FormattedData;
    private firestore: Firestore;
    private config: ImportConfig;
    private aliases: Record<string, string>;

    constructor(firestore: Firestore, config: Partial<ImportConfig> = {}) {
        this.documents = {};
        this.firestore = firestore;
        this.aliases = {};
        this.config = Object.assign({
            autoId: true,
            prefix: false,
            idField: false,
            types: {},
        }, config);
    }

    private formatCollection(docs: Collection, path = []): void {
        if (Array.isArray(docs)) {
            const object = {};
            docs.forEach((item, index) => {
                let id: string;
                if (this.config.idField && item[this.config.idField]) {
                    id = item[this.config.idField];
                    delete item[this.config.idField];
                } else if (this.config.autoId) {
                    let parent: string = path.slice(-1)[0];
                    if (path.length === 1 && typeof this.config.prefix === 'string') {
                        parent = parent.substr(this.config.prefix.length);
                    }
                    id = parent.replace(/s$/, '') + '-' + (index + 1);
                } else {
                    id = this.firestore.collection(path.join('/')).doc().id;
                }
                object[id] = item;
            });
            docs = object;
        }
        for (const id in docs) {
            path.push(id);
            this.formatDocument(docs[id], path);
            path.pop();
        }
    }

    private formatDocument(data: Document, path: string[]): void {
        const formatted = {};
        for (let field in data) {
            const value = data[field];
            const res = this.getFieldType(field, value);
            const type = res.type;
            field = res.field;
            path.push(field);
            if (type === 'collection') {
                this.formatCollection(value as Collection, path);
            } else {
                formatted[field] = this.formatField(value, type, path);
            }
            path.pop();
        }
        this.documents[path.join('/')] = formatted;
    }

    private getFieldType(field: string, value: unknown, numKey = false): { type: string | null, field: string } {
        if (!numKey) {
            const parts = field.split(':');
            if (parts.length > 1) {
                return { type: parts[1], field: parts[0] };
            }
            for (const type in this.config.types) {
                if (this.config.types[type].includes(field)) {
                    return { type: type, field: field };
                }
            }
        }
        return { type: value === null ? 'null' : typeof value, field: field };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private formatField(value: any, type: string, path: string[] = []): FireValue {
        // Array with global type.
        if (Array.isArray(value) && type !== 'object') {
            value.forEach((item, i) => {
                path.push(i as unknown as string);
                value[i] = this.formatField(item, 'reference', path);
                path.pop();
            });
            return value as FireValue;
        }
        // Check other types.
        if (['object', 'array', 'geopoint', 'timestamp'].includes(type)) {
            if (typeof value !== 'object') {
                throw Error(`Invalid type '${typeof value}' for ${type}' (${path.join('/')}'). Expecting 'object'.`);
            }
        } else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
            throw Error(`Invalid type '${typeof value}' for '${path.join('/')}'. Expecting 'string|number|boolean.'`);
        }
        // Convert the value.
        let isArray: boolean;
        let parts: string[];
        let copy: [] | Record<string, unknown>;
        let date: Date;
        switch (type) {
            case 'reference':
                parts = value.split('/');
                if (parts.length && parts[0] === '') {
                    parts.shift();
                }
                if (parts.length && this.aliases[parts[0]]) {
                    parts[0] = this.aliases[parts[0]];
                }
                value = parts.join('/');
                value = this.firestore.doc(value);
                break;
            case 'array': // Array converted to object.
            case 'object':
                isArray = Array.isArray(value);
                copy = (type === 'array' || isArray) ? [] : {};
                for (let key in value) {
                    const data = value[key];
                    const res = this.getFieldType(key, data, isArray);
                    key = res.field;
                    path.push(key);
                    copy[key] = this.formatField(data, res.type, path);
                    path.pop();
                }
                value = copy;
                break;
            case 'date':
                date = new Date(value);
                value = isNaN(date.getTime()) ? value : Timestamp.fromDate(new Date(value));
                break;
            case 'geopoint':
                if (typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
                    throw Error(`Invalid latitude or longitude type for GeoPoint('${path.join('/')}').`);
                }
                value = new GeoPoint(value.latitude, value.longitude);
                break;
            case 'timestamp':
                if (typeof value.seconds !== 'number' || typeof value.nanoseconds !== 'number') {
                    throw Error(`Invalid seconds or nanoseconds type for Timestamp('${path.join('/')}').`);
                }
                value = new Timestamp(value.seconds, value.nanoseconds);
                break;
        }
        return value;
    }

    public format(dataOrPath: string | Record<string, Collection>): FormattedData {
        let collections: Record<string, Collection>;
        if (typeof dataOrPath === 'string') {
            // Use readFileSync() instead of require() to get a plain object.
            const jsonData = readFileSync(process.cwd() + '/' + dataOrPath);
            collections = JSON.parse(jsonData as unknown as string);
        } else if (dataOrPath.constructor === Object) {
            collections = dataOrPath;
        } else {
            throw new Error('Invalid argument. Expecting object or string.');
        }
        // Must add all aliases first.
        if (typeof this.config.prefix === 'string') {
            Object.keys(collections).forEach(key => {
                this.aliases[key] = this.config.prefix + key;
            });
        }
        for (const path in collections) {
            const alias = this.aliases[path] ? this.aliases[path] : path;
            this.formatCollection(collections[path], [alias]);
        }
        return this.documents;
    }

    public async process(dataOrPath: string | Record<string, Collection>): Promise<WriteResult[]> {
        this.format(dataOrPath);
        if (Object.keys(this.documents).length > 500) {
            throw new Error('Only 500 documents can be imported at the time.');
        }
        const batch = this.firestore.batch();
        for (const path in this.documents) {
            batch.set(this.firestore.doc(path), this.documents[path]);
        }
        return await batch.commit();
    }

}