import { Firestore } from '@google-cloud/firestore';
import { Schema } from './Schema';
import { ConfigOptions, Constructor, ModelConfig, ModelConstructor, SchemaData, SchemaField } from './types';
import pluralize = require('pluralize');
import { Collection } from './Collection';
import { Model } from './Model';

type CallbackData = {
    model: Model,
    method: string,
    args: unknown[],
};

type ModelSpecs = {
    primary: boolean,
    formatted: boolean,
    inspected: boolean,
    config: ModelConfig,
    schema: SchemaData,
    callbacks: string[],
    defaults: {
        instance: { [x: string]: unknown },
        schema: { [x: string]: unknown },
    }
};

export class Metadata {

    public firestore: Firestore;

    public config: ConfigOptions;

    public models: {
        [x: string]: ModelSpecs,
    };

    public callbacks: {
        [x: string]: CallbackData[]
    };

    public collections: {
        [x: string]: Collection<Model>
    };

    constructor() {
        this.firestore = null;
        this.config = {
            primaryKeyName: 'id',
            getOptions: {
                populatePrimaryKey: true,
                populateCreateTime: false,
                populateUpdateTime: false,
                returnAllFields: false,
                returnAsJSON: false,
            },
        };
        this.models = {};
        this.callbacks = {};
        this.collections = {};
    }

    getFirestore(): Firestore {
        if (!this.firestore) {
            throw Error('Firesnap hasn\'t been initialized');
        }
        return this.firestore;
    }

    getModelKey(model: Constructor): string {
        let modelKey: string = model[Symbol.for('modelKey')];
        if (!modelKey) {
            let count = 1;
            while (this.models[`${model.name}_${count}`]) {
                count++;
            }
            modelKey = `${model.name}_${count}`;
            Object.defineProperty(model, Symbol.for('modelKey'), {
                value: modelKey,
            });
        }
        return modelKey;
    }

    getCollection<T extends Model>(model: ModelConstructor<T>): Collection<T> {
        const modelKey = this.getModelKey(model);
        const collection = this.collections[modelKey] ? this.collections[modelKey] : null;
        return collection as Collection<T>;
    }

    setCollection<T extends Model>(model: ModelConstructor<T>, collection: Collection<T>): void {
        const modelKey = this.getModelKey(model);
        this.collections[modelKey] = collection;
    }

    initModelData(modelKey: string): void {
        this.models[modelKey] = {
            primary: null,
            formatted: false,
            inspected: false,
            config: null,
            schema: null,
            callbacks: [],
            defaults: null,
        };
    }

    getModelSpecs(model: ModelConstructor | Constructor): ModelSpecs {
        const modelKey = this.getModelKey(model);
        if (!this.models[modelKey]) {
            this.initModelData(modelKey);
        }
        if (!this.models[modelKey].inspected) {
            const data = this.inspectModel(model);
            data.inspected = true;
            Object.assign(this.models[modelKey], data);
        }
        return this.models[modelKey];
    }

    inspectModel(model: ModelConstructor | Constructor): Partial<ModelSpecs> {
        model[Symbol.for('inspecting')] = true;
        const instance = new model();
        delete model[Symbol.for('inspecting')];
        const metadata: Partial<ModelSpecs> = {
            primary: instance instanceof Model,
            callbacks: [],
            defaults: {
                instance: {},
                schema: {},
            },
        };
        // Get the default values.
        Object.keys(instance).forEach(prop => {
            metadata.defaults.instance[prop] = instance[prop];
        });
        // Keep track of the model type.
        Object.defineProperty(model, Symbol.for('primaryModel'), {
            value: metadata.primary,
        });
        if (!metadata.primary) {
            return metadata;
        }
        // Get the schema  model = model as ModelConstructor;. 
        const primary = model as ModelConstructor;
        if (typeof primary.schema === 'object' && primary.schema !== null) {
            for (const field in primary.schema) {
                if (primary.schema[field].default !== undefined) {
                    metadata.defaults.schema[field] = primary.schema[field].default;
                }
            }
        }
        // Get the list of callbacks.
        const proto = Object.getPrototypeOf(instance);
        Object.getOwnPropertyNames(proto).forEach((prop) => {
            if (['beforeSave', 'afterSave', 'beforeDelete', 'afterDelete'].includes(prop)) {
                metadata.callbacks.push(prop);
            }
        });
        // Get the config Vanilla JS.
        if (typeof primary.config === 'object' && primary.config !== null) {
            metadata.config = Object.assign({
                path: pluralize(primary.name).replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase(),
                ownerField: null,
            }, primary.config);
        }
        return metadata;
    }

    getModelSchema(model: Constructor): SchemaData {
        const modelKey = this.getModelKey(model);
        if (!this.models[modelKey] || !this.models[modelKey].schema) {
            return null;
        }
        if (!this.models[modelKey].formatted) {
            const result = Schema.format(this.models[modelKey].schema, this.models[modelKey].config);
            if (!result.valid) {
                const field = Object.keys(result.errors)[0];
                throw Error(`${model.name} Schema, field '${field}': ${result.errors[field]}`);
            }
            this.models[modelKey].schema = result.schema;
            this.models[modelKey].formatted = true;
        }
        return this.models[modelKey].schema;
    }

    setModelSchema(model: Constructor, schema: SchemaData): void {
        const modelKey = this.getModelKey(model);
        if (!this.models[modelKey]) {
            this.initModelData(modelKey);
        }
        this.models[modelKey].schema = schema;
    }

    setSchemaField(model: Constructor, field: string, rules: SchemaField): void {
        const modelKey = this.getModelKey(model);
        if (!this.models[modelKey]) {
            this.initModelData(modelKey);
        }
        if (!this.models[modelKey].schema) {
            this.models[modelKey].schema = {};
        }
        this.models[modelKey].schema[field] = rules;
    }

    setModelConfig(model: ModelConstructor, options: Partial<ModelConfig>): void {
        const modelKey = this.getModelKey(model);
        if (!this.models[modelKey]) {
            this.initModelData(modelKey);
        }
        this.models[modelKey].config = Object.assign({
            path: pluralize(model.name).replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase(),
            ownerField: null,
        }, options as ModelConfig);
    }

    storeCallback(sessionId: string, model: Model, method: string, args: unknown[] = []): void {
        if (!this.callbacks[sessionId]) {
            this.callbacks[sessionId] = [];
        }
        this.callbacks[sessionId].push({
            model: model,
            method: method,
            args: args,
        });
    }

    getCallbacks(sessionId: string): CallbackData[] {
        if (this.callbacks[sessionId]) {
            return this.callbacks[sessionId];
        } else {
            return [];
        }
    }

    clearCallbacks(sessionId: string): void {
        if (this.callbacks[sessionId]) {
            delete this.callbacks[sessionId];
        }
    }
}

export const Storage = new Metadata();