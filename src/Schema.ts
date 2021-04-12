import { DataTypeString, ModelConfig, SchemaData, SchemaField } from './types';
import { constructorName, isModelConstructor } from './utils';
import { ValidationRules } from './Validator/ValidationRules';
import { Storage } from './Metadata';

type FormatResult = {
    schema: SchemaData,
    errors: { [x: string]: string },
    valid: boolean
}

export class Schema {

    /**
     * Supported field data types.
     */
    static types = [
        'String',
        'Number',
        'Date',
        'Boolean',
        'Array',
        'Object',
        'Reference',
        'Collection',
        'GeoPoint',
        'Timestamp',
        'SubModel',
    ];

    /**
     * Flatten a formatted schema. 
     */
    static flatten(src: SchemaData, path = []): SchemaData {
        const obj = Object.assign({}, src);
        return Object.keys(obj).reduce((memo, prop) => Object.assign({}, memo,
            (() => {
                if (typeof obj[prop] !== 'object' || (this.types.includes(obj[prop].type as DataTypeString) && !obj[prop].of)) {
                    obj[prop] = { [path.concat([prop]).join('.')]: obj[prop] };
                } else {
                    obj[prop] = Schema.flatten(obj[prop].of as SchemaData, path.concat([prop]));
                }
                return obj[prop];
            })()
        ), {});
    }

    /**
     * Reformat the rules recursively.
     */
    static format(schema: SchemaData, config: Partial<ModelConfig> = {}, path: string[] = []): FormatResult {
        const formatted = {};
        const errors = {};
        const ownerRules = [];
        for (const field in schema) {
            path.push(field);
            let rules = schema[field];
            if (Array.isArray(rules) || typeof rules === 'function' || typeof rules === 'string') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                rules = { type: rules as any };
            } else if (!rules) {
                rules = { type: undefined };
            }
            // Reformat arrays.
            if (Array.isArray(rules.type)) {
                if (rules.type.length > 0) {
                    rules.of = rules.type[0];
                    if (isModelConstructor(rules.of)) {
                        rules.model = rules.of;
                        rules.of = 'Reference';
                    }
                }
                rules.type = 'Array';
            }
            // Reformat objects. 
            if (!Object.prototype.hasOwnProperty.call(rules, 'type') || (rules.type && typeof rules.type === 'object')) {
                const kind = rules;
                rules = { type: 'Object' };
                if (Object.keys(kind).length) {
                    rules.of = kind as SchemaData;
                }
            }
            // Reformat doc reference.
            if (rules.type && typeof(rules.type) === 'function' && isModelConstructor(rules.type)) {
                rules.model = rules.type;
                rules.type = 'Reference';
            }
            // Convert the [type] to string.
            if (rules.type !== undefined && typeof rules.type !== 'string') {
                rules.type = rules.type.name as DataTypeString;
            }
            // Format objects recursively.
            if (rules.type === 'Object' && rules.of && rules.of.constructor === Object) {
                const result = Schema.format(rules.of as SchemaData, config, path);
                rules.of = result.schema;
                for (const key in result.errors) {
                    errors[key] = result.errors[key];
                }
            }
            // Convert the [of] to string.
            else if (rules.of && typeof rules.of !== 'string') {
                rules.of = rules.of.name as Exclude<DataTypeString, 'Collection'>;
            }
            // Check the rules. 
            const error = Schema.error(rules);
            if (error) {
                errors[path.join('.')] = error;
            }
            if (rules.read && rules.read === 'owner') {
                ownerRules.push(path.join('.'));
            }
            formatted[field] = rules;
            path.pop();
        }
        // Check the ownerField. 
        if (ownerRules.length && config.ownerField && config.ownerField !== Storage.config.primaryKeyName) {
            let error: string = null;
            if (typeof config.ownerField !== 'string') {
                error = 'Schema ownerField type is invalid. Expecting String';
            } else if (formatted[config.ownerField] === undefined) {
                error = `Schema ownerField, '${config.ownerField}' is not defined`;
            } else if (!['String', 'Reference'].includes(formatted[config.ownerField].type)) {
                error = `Schema ownerField, '${config.ownerField}' is invalid. Expecting String or Reference`;
            }
            if (error) {
                ownerRules.forEach(key => {
                    errors[key] = error;
                });
            }
        }
        return {
            errors: errors,
            schema: formatted,
            valid: (Object.keys(errors).length < 1),
        };
    }

    /**
     * Return eventual rule error.
     */
    private static error(rules: SchemaField): string | false {
        if (!rules.type) {
            return 'No type defined';
        }
        if (!this.types.includes(rules.type as string)) {
            return `Type '${rules.type}' is invalid. Expecting [${this.types.join('|')}]`;
        }
        // Array types. 
        if (rules.type === 'Array' && !rules.of) {
            return 'No Array type defined.';
        }
        if (rules.type === 'Array' && !this.types.includes(rules.of as string)) {
            return `Invalid Array type ${rules.of}. Expecting [${this.types.join('|')}]`;
        }
        // Enum value.
        if (rules.enum) {
            if (rules.type !== 'Number' && rules.type !== 'String') {
                return 'Rule \'enum\' is only applicable to String or Number';
            }
            if (!Array.isArray(rules.enum) || !rules.enum.every((x: string | number) => constructorName(x) === rules.type)) {
                return `Invalid enum values. Expecting '${rules.type}'`;
            }
        }
        // Default value (allow null). 
        if (rules.default) {
            const value = typeof rules.default === 'function' ? rules.default() : rules.default;
            if (constructorName(value) !== rules.type) {
                return `Invalid default value of type '${constructorName(value)}'. Expecting type '${rules.type}'`;
            }
        }
        // Reference & Collection Model.
        if ((rules.type === 'Reference' || rules.type === 'Collection')) {
            if (rules.model === undefined) {
                return `Type '${rules.type}' has no model defined`;
            }
            if (typeof rules.model !== 'function' || !isModelConstructor(rules.model)) {
                return `Type '${rules.type}' has an invalid model`;
            }
        }
        // Validation rules.
        for (const name in ValidationRules) {
            if (!Object.prototype.hasOwnProperty.call(rules, name)) {
                continue;
            }
            const validate = ValidationRules[name];
            if (validate.valType !== rules.type) {
                return `Rule '${name}' is only applicable to '${validate.valType}'`;
            }
            let constraint = rules[name];
            if (Array.isArray(constraint)) {
                if (constraint.length != 2 || typeof constraint[1] !== 'string') {
                    return `Rule '${name}' has an invalid constraint. Expecting '[constraint, message]' or 'constraint'`;
                }
                constraint = constraint[0];
            }
            if (constructorName(constraint) !== validate.cstType) {
                const type = constructorName(constraint);
                return `Rule '${name}' has an invalid constraint type '${type}'. Expecting '${validate.cstType}'`;
            }
        }
        // Custom validation.
        if (rules.validate) {
            if (typeof rules.validate != 'object' || typeof rules.validate.validator !== 'function' ||
                (rules.validate.message && !['string', 'function'].includes(typeof rules.validate.message))
            ) {
                return 'Rule validate is invalid. Expecting { validator: Function, message?: Function | String }';
            }
        }
        return false;
    }

}