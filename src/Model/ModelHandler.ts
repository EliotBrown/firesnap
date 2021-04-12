import { FieldValue } from '@google-cloud/firestore';
import { Collection } from '../Collection';
import { Storage } from '../Metadata';
import { Constructor, ModelConstructor, ModelData } from '../types';
import { constructorName, isSubModelInstance } from '../utils';
import { Model } from './Model';

export const ModelHandler = {
    get(obj: Model, prop: string): unknown {
        if (typeof prop === 'string' && obj[prop] && obj[Symbol.for('tracking')] &&
            (obj[prop].constructor === Object || isSubModelInstance(obj[prop]))
        ) {
            if (!obj[prop][Symbol.for('model')]) {
                Object.defineProperty(obj[prop], Symbol.for('model'), {
                    value: obj,
                    writable: true,
                });
                Object.defineProperty(obj[prop], Symbol.for('prop'), {
                    value: prop,
                    writable: true,
                });
            }
            return new Proxy(obj[prop], ObjectWatcher);
        }
        return obj[prop];
    },
    set(obj: Model, prop: string, value: unknown): boolean {
        // Prevent from overwriting methods.
        if (typeof obj[prop] === 'function') {
            return true;
        }
        if (typeof prop === 'string') {
            // Skip the Model default values already assigned by the parent the constructor.
            if (obj[Symbol.for('skipDef')] && obj[Symbol.for('skipDef')][prop] !== undefined) {
                delete obj[Symbol.for('skipDef')][prop];
                return true;
            }
            // TODO: Implement nested conversion for Object (this will be done later).
            if (value && ['Array', 'Number', 'String', 'Object'].includes(value.constructor.name)) {
                const schema = (obj.constructor as ModelConstructor).getSchema();
                if (schema[prop]) {
                    const rules = schema[prop];
                    // Single Reference.
                    if (rules.type === 'Reference') {
                        if (typeof value === 'string') {
                            value = (rules.model as ModelConstructor).ref(value);
                        } else if (value.constructor === Object) {
                            value = new rules.model(value);
                        }
                    }
                    // Sub model.
                    else if (rules.type === 'SubModel') {
                        if (value && value.constructor === Object) {
                            value = instantiateSchema(rules.model, value);
                        }
                    }
                    // Array of references.
                    else if (rules.type === 'Array' && rules.of === 'Reference' && value instanceof Array) {
                        value.forEach((item, i) => {
                            if (typeof item === 'string') {
                                value[i] = (rules.model as ModelConstructor).ref(item);
                            } else if (item && item.constructor === Object) {
                                value[i] = new rules.model(item);
                            }
                        });
                    }
                    // Date.
                    else if (rules.type === 'Date' && (typeof value === 'string' || typeof value === 'number')) {
                        const date = new Date(value);
                        value = isNaN(date.getTime()) ? value : date;
                    }
                    // Sub-collection
                    else if (rules.type === 'Collection' && constructorName(value) !== 'Collection' && Array.isArray(value)) {
                        value = new Collection((rules.model as ModelConstructor), null, value);
                    }
                }
            }
            // Keep track of changes.
            if (obj[Symbol.for('tracking')]) {
                obj[Symbol.for('changes')][prop] = value;
            }
        }
        obj[prop] = value;
        return true;
    },
    deleteProperty(obj: Model, prop: string): boolean {
        if (prop in obj) {
            if (obj[Symbol.for('tracking')]) {
                obj[Symbol.for('changes')][prop] = FieldValue.delete();
            }
            delete obj[prop];
        }
        return true;
    },
};

/**
 * Keep track of changes recursively.
 */
const ObjectWatcher = {
    get(obj: Record<symbol, unknown>, prop: string) {
        if (typeof prop === 'string' && obj[prop] &&
            (obj[prop].constructor === Object || isSubModelInstance(obj[prop]))
        ) {
            Object.defineProperty(obj[prop], Symbol.for('model'), {
                value: obj[Symbol.for('model')],
                writable: true, 
            });
            Object.defineProperty(obj[prop], Symbol.for('prop'), {
                value: obj[Symbol.for('prop')],
                writable: true,
            });
            return new Proxy(obj[prop], ObjectWatcher);
        }
        return obj[prop];
    },
    set(obj: Record<symbol, unknown>, prop: string, value: unknown) {
        this.recordChange(obj);
        obj[prop] = value;
        return true;
    },
    deleteProperty(obj: Record<string, unknown>, prop: string) {
        if (prop in obj) {
            this.recordChange(obj);
        }
        delete obj[prop];
        return true;
    },
    recordChange(obj: Record<symbol, unknown>) {
        const model = obj[Symbol.for('model')];
        model[Symbol.for('changes')][obj[Symbol.for('prop')]] = model[obj[Symbol.for('prop')]];
    },
};

/**
 * Instantiate sub-models recursively
 */
const instantiateSchema = (model: Constructor, value: ModelData): InstanceType<Constructor> => {
    const schema = Storage.getModelSchema(model);
    const instance = new model();
    Object.keys(value).forEach(key => {
        if (value && value.constructor === Object && schema && schema[key] && schema[key].type === 'SubModel') {
            instance[key] = instantiateSchema(schema[key].model, value[key]);
        } else {
            instance[key] = value[key];
        }
    });
    return instance;
};