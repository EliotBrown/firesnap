import { expandObject, flattenObject, constructorName } from '../utils';
import { ModelData, ValidationOptions, ValidationResult, SchemaData, ValidationConstraint, DataTypeString } from '../types';
import { ValidationRules } from './ValidationRules';
import { Schema } from '../Schema';
import { Storage } from '../Metadata';
import { Model } from '../Model';

export class Validator {

    /**
     * Check model data against a schema.
     */
    static async check(schema: SchemaData, data: ModelData, options: ValidationOptions = {}): Promise<ValidationResult> {
        const errors = {};
        const cleaned = {};
        // Required fields (must be first).
        if (options.newDocument) {
            for (const field in schema) {
                const rules = schema[field];
                if (rules.required && (data[field] === undefined || data[field] === '')) {
                    const constraint = this.constraint(rules.required, 'This field is required');
                    if (constraint.value === true) {
                        errors[field] = constraint.message;
                    }
                }
            }
        }
        fields:
        for (const field in data) {
            let value = data[field];
            const rules = schema[field];
            if (rules === undefined || errors[field] !== undefined) {
                continue;
            }
            // Null/Undefined value (must be first).
            if (value === null) {
                if (rules.null === true) {
                    cleaned[field] = data[field];
                } else {
                    errors[field] = 'Null value not allowed for this field';
                }
                continue;
            }
            if (value === undefined) {
                errors[field] = 'Value is undefined';
                continue;
            }
            // Allow standalone validation without type.
            if (!rules.type) {
                rules.type = constructorName(value) as DataTypeString;
            }
            // Firestore FieldValue.
            if (['NumericIncrementTransform', 'DeleteTransform', 'ArrayUnionTransform',
                'ArrayRemoveTransform', 'ServerTimestampTransform'].includes(value.constructor.name)
            ) {
                cleaned[field] = data[field];
                continue;
            }
            // Check the type. 
            if (rules.type !== 'Reference' && rules.type !== 'SubModel' && constructorName(value) !== rules.type) {
                errors[field] = `Invalid type '${constructorName(value)}'. Expecting type '${rules.type}'`;
                continue;
            }
            // Object types.
            let result: ValidationResult;
            let subSchema: SchemaData;
            switch (rules.type) {
                case 'Reference':
                    if (value.constructor.name !== rules.model.name) {
                        errors[field] = `Invalid type '${value.constructor.name}'. Expecting type '${rules.model.name}'`;
                        continue;
                    }
                    result = await (value as Model).validate();
                    for (const key in result.errors) {
                        errors[`${field}.${key}`] = result.errors[key];
                    }
                    if (!result.valid) {
                        continue fields;
                    }
                    break;
                case 'Collection':
                    for (const i in value as Model[]) {
                        const item = value[i];
                        if (constructorName(item) !== rules.model.name) {
                            errors[`${field}[${i}]`] = `Invalid type '${constructorName(item)}'. Expecting type '${rules.model.name}'`;
                            continue fields;
                        }
                        const result = await item.validate();
                        for (const key in result.errors) {
                            errors[`${field}[${i}]${key}`] = result.errors[key];
                        }
                        if (!result.valid) {
                            continue fields;
                        }
                    }
                    break;
                case 'SubModel':
                    subSchema = Storage.getModelSchema(rules.model);
                    if (subSchema) {
                        result = await Validator.check(subSchema, value as ModelData, options);
                        for (const key in result.errors) {
                            errors[`${field}.${key}`] = result.errors[key];
                        }
                        if (!result.valid) {
                            continue fields;
                        }
                        data[field] = result.data;
                    }
                    break;
                case 'Object':
                    // DEV: Rules for Typescript objects have no property "of".
                    if (rules.of && Object.keys(rules.of).length) {
                        const flatSchema = Schema.flatten(rules.of as SchemaData);
                        const flatObject = flattenObject(value as Record<string, unknown>, true);
                        const result = await Validator.check(flatSchema, flatObject, options);
                        for (const key in result.errors) {
                            errors[`${field}.${key}`] = result.errors[key];
                        }
                        if (!result.valid) {
                            continue fields;
                        }
                        value = expandObject(flatObject);
                    }
                    break;
                case 'Array':
                    for (const i in value) {
                        const item = value[i];
                        const type = constructorName(item);
                        if (rules.of === 'Reference') {
                            if (type !== rules.model.name) {
                                errors[`${field}[${i}]`] = `Invalid type '${type}'. Expecting type '${rules.model.name}'`;
                                continue fields;
                            }
                            const result = await item.validate();
                            for (const key in result.errors) {
                                errors[`${field}[${i}]${key}`] = result.errors[key];
                            }
                            if (!result.valid) {
                                continue fields;
                            }
                        } else if (type !== rules.of) {
                            errors[`${field}[${i}]`] = `Invalid type '${type}'. Expecting type '${rules.of}'`;
                            continue fields;
                        }
                    }
                    break;
            }
            // Enum rule. 
            if (rules.enum && !rules.enum.includes(value)) {
                errors[field] = `Invalid value '${value}'. Allowed values ['${rules.enum.join('|')}']`;
                continue;
            }
            // Built-in rules. 
            for (const name in ValidationRules) {
                const validate = ValidationRules[name];
                if (rules[name]) {
                    let message: string;
                    let constraint: number | boolean;
                    if (Array.isArray(rules[name])) {
                        constraint = rules[name][0];
                        message = rules[name][1];
                    } else {
                        constraint = rules[name];
                        message = validate.message({ name: field, value: value, constraint: constraint as number });
                    }
                    if (!validate.validator(value, constraint)) {
                        errors[field] = message;
                        continue fields;
                    }
                }
            }
            // Custom rules. 
            if (rules.validate && errors[field] === undefined) {
                if (!rules.validate.validator(value)) {
                    let message = 'Invalid value';
                    if (typeof rules.validate.message === 'string') {
                        message = rules.validate.message;
                    } else if (typeof rules.validate.message === 'function') {
                        message = rules.validate.message({ name: field, value: value }).toString();
                    }
                    errors[field] = message;
                    continue;
                }
            }
            // Admin rule.
            if (rules.write === 'admin' && options.authValue !== null &&
                options.authValue !== undefined && options.authValue !== true
            ) {
                errors[field] = 'Admin permission required';
                continue;
            }
            cleaned[field] = data[field];
        }

        return {
            valid: (Object.keys(errors).length < 1),
            errors: errors,
            data: cleaned,
        };
    }

    /**
     * Reformat rule constraint.
     */
    static constraint(constraint: ValidationConstraint, message: string): { value: boolean | number, message: string } {
        if (Array.isArray(constraint)) {
            message = constraint[1].toString();
            constraint = constraint[0];
        }
        return { value: constraint, message: message };
    }

}

