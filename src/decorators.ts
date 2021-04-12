
import type { SchemaField, ModelConfig, Constructor, ModelConstructor, FieldOptions, DataTypeConstructor, DataTypeString } from './types';
import { Storage } from './Metadata';
import { isModelConstructor } from './utils';
import 'reflect-metadata';
import { Model } from './Model';

export function Collection(model: ModelConstructor) {
    return (target: Model, field: string): void => {
        const rules: SchemaField = {
            model: model,
            type: 'Collection',
        };
        Storage.setSchemaField(target.constructor as Constructor, field, rules);
    };
}

export function Field(options: FieldOptions = {}) {
    return (target: unknown, field: string): void => {
        const rules = options as SchemaField;
        const specs = Storage.getModelSpecs(target.constructor as Constructor);
        // Detect the field type.
        let type: DataTypeConstructor | string;
        if (specs.defaults.instance[field] !== undefined && specs.defaults.instance[field] !== null) {
            const value = specs.defaults.instance[field];
            if (typeof value === 'function') {
                if (value === Date.now) {
                    type = Date;
                } else {
                    type = value() ? value().constructor : 'Undefined';
                }
            } else {
                type = value.constructor as DataTypeConstructor;
            }
            if (type === Array && (value as []).length && value[0] !== undefined && value[0] !== null) {
                rules.of = value[0].constructor;
            }
        } else {
            type = Reflect.getMetadata('design:type', target, field);
        }
        // Single Document Reference.
        if (isModelConstructor(type)) {
            rules.model = type;
            type = 'Reference';
        }
        // Nested field (type class)
        else if (type && /^class\s.+/.test(type.toString())) {
            rules.model = type as Constructor;
            type = 'SubModel';
        }
        // Array of Reference.
        else if (type === Array && rules.of && isModelConstructor(rules.of)) {
            rules.model = rules.of;
            rules.of = 'Reference';
        }
        rules.type = type ? (typeof type === 'string' ? type : type.name) as DataTypeString : undefined;
        Storage.setSchemaField(target.constructor as Constructor, field, rules);
    };
}

export function Schema(options: Partial<ModelConfig> = {}) {
    return (target: unknown): void => {
        if (isModelConstructor(target)) {
            Storage.setModelConfig(target, options);
        }
    };
}