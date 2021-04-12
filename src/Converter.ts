import { DocumentReference, QueryDocumentSnapshot, Timestamp } from '@google-cloud/firestore';
import { Storage } from './Metadata';
import { Collection } from './Collection';
import { GetOptions, ModelConstructor, ModelData, PopulatedDocSnapshot, QueryData } from './types';
import { constructorName, isSubModelInstance } from './utils';
import { Model } from './Model';

export class Converter {

    /**
     * Convert model data to Firestore data.
     */
    static toFirestore(data: ModelData): ModelData {
        const formatted = Array.isArray(data) ? [] : {};
        for (const field in data) {
            const value = data[field];
            switch (constructorName(value)) {
                case 'Collection':
                    break;
                case 'Document':
                    formatted[field] = Storage.getFirestore().doc(value.path + '/' + value.id);
                    break;
                case 'Array':
                case 'Object':
                    formatted[field] = Converter.toFirestore(value);
                    break;
                default:
                    if ((isSubModelInstance(value))) {
                        formatted[field] = Converter.toFirestore(value);
                    } else {
                        formatted[field] = value;
                    }
                    break;
            }
        }
        return formatted;
    }

    /**
     * Convert Firestore data to model instance or JSON object.
     */
    static fromFirestore(doc: PopulatedDocSnapshot, model: ModelConstructor, query: Partial<QueryData>, options: GetOptions = {}): Model {
        options = Object.assign({}, Storage.config.getOptions, options);
        if (Array.isArray(query.fields) && query.populate instanceof Object) {
            query.fields = query.fields.concat(Object.keys(query.populate));
        }
        const formatted = {};
        const idField = Storage.config.primaryKeyName;
        if (options.populatePrimaryKey && (!query.fields || query.fields.includes(idField))) {
            formatted[idField] = doc.id;
        }
        const data = doc.data();
        if (!data) {
            return null;
        }
        const ownerField = model.getConfig('ownerField');
        const schema = model.getSchema();

        // Return fields defined in schema first. 
        for (const field in schema) {
            const rules = schema[field];
            // Sub-collection first (value is undefined)
            if (rules.type === 'Collection' && doc.populated && doc.populated[field]) {
                const model = rules.model as ModelConstructor;
                formatted[field] = new Collection(model, doc.ref.path);
                doc.populated[field].forEach((doc: PopulatedDocSnapshot) => {
                    formatted[field].push(Converter.fromFirestore(doc, model, query.populate[field], options));
                });
                continue;
            }
            if (data[field] === undefined || (query.fields && !query.fields.includes(field))) {
                continue;
            }
            // Check the auth.
            if (rules.read && query.auth !== undefined && query.auth !== true) {
                if (query.auth === false || (ownerField !== Storage.config.primaryKeyName && !data[ownerField])) {
                    continue;
                }
                let ownerId: string;
                if (ownerField !== Storage.config.primaryKeyName) {
                    ownerId = constructorName(data[ownerField]) === 'DocumentReference' ? data[ownerField].id : data[ownerField];
                } else {
                    ownerId = doc.id;
                }
                if (query.auth !== ownerId) {
                    continue;
                }
            }
            // Null value. 
            if (data[field] === null) {
                formatted[field] = null;
                continue;
            }
            // Single reference.
            let value = data[field];
            if (constructorName(value) === 'DocumentReference' && rules.type === 'Reference') {
                const model = rules.model as ModelConstructor;
                if (doc.populated && doc.populated[field] && doc.populated[field].length) {
                    value = Converter.fromFirestore(doc.populated[field][0], model, query.populate[field], options);
                } else if (!options.returnAsJSON) {
                    value = new model({}, value);
                } else if (options.populatePrimaryKey) {
                    value = { [idField]: value.id };
                } else {
                    // Remove missing ref for JSON format with no populated Id.
                    continue;
                }
            }
            // Array of references. 
            else if (value.constructor.name === 'Array' && rules.type === 'Array' && rules.of === 'Reference') {
                const model = rules.model as ModelConstructor;
                const populated = {};
                if (doc.populated && doc.populated[field]) {
                    doc.populated[field].forEach((doc: QueryDocumentSnapshot) => {
                        populated[doc.ref.id] = doc;
                    });
                }
                const items = [];
                value.forEach((docRef: DocumentReference, i: number) => {
                    if (docRef && constructorName(docRef) === 'DocumentReference') {
                        if (populated[docRef.id]) {
                            items.push(Converter.fromFirestore(populated[docRef.id], model, query.populate[field], options));
                        } else {
                            // Exclude missing ref for JSON format with no populated Id.
                            if (!options.returnAsJSON) {
                                items.push(new model({}, docRef));
                            } else if (options.populatePrimaryKey) {
                                items.push({ [idField]: docRef.id });
                            }
                        }
                    } else {
                        items.push(value[i]);
                    }
                });
                value = items;
            }
            // Timestamp
            else if (value instanceof Timestamp && rules.type === 'Date') {
                value = value.toDate();
            }
            formatted[field] = value;
        }
        // Return other fields.
        if (options.returnAllFields) {
            for (const field in data) {
                if (formatted[field] === undefined && (!query.fields || query.fields.includes(field))) {
                    formatted[field] = data[field];
                }
            }
        }
        // Populate created/updated times.
        if (options.populateCreateTime && (!query.fields || query.fields.includes(options.populateCreateTime))) {
            formatted[options.populateCreateTime] = doc.createTime.toDate();
        }
        if (options.populateUpdateTime && (!query.fields || query.fields.includes(options.populateUpdateTime))) {
            formatted[options.populateUpdateTime] = doc.updateTime.toDate();
        }
        if (options.returnAsJSON) {
            // Note: We still return as type 'Model' to populate properties. 
            return formatted as Model;
        } else {
            return new model(formatted, doc);
        }
    }
}

