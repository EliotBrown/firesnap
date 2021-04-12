import { expect } from './utility/chai-setup';
import { Schema } from '../src/Schema';
import { Model } from '../src/Model/Model';
import { Timestamp } from '@google-cloud/firestore';
import { SchemaData } from '../src/types';

describe('Schema', () => {

    // -------------------------------------------------------------------------
    // Unit Tests
    // -------------------------------------------------------------------------

    it('should convert all types to string short syntaxes', async () => {
        class MainModel extends Model {
            //Empty
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema: any = {
            empty1: undefined,
            empty2: null,
            string: String,
            date: 'Date',
            time: Timestamp,
            reference: MainModel,
            object1: { type: 'Object' },
            object2: { type: {} },
            object3: { prop: String },
            array1: [String],
            array2: [MainModel],
        };
        const result = Schema.format(schema);
        expect(result.schema).to.deep.include({
            empty1: { type: undefined },
            empty2: { type: undefined },
            string: { type: 'String' },
            date: { type: 'Date' },
            time: { type: 'Timestamp' },
            reference: { type: 'Reference', model: MainModel },
            object1: { type: 'Object' },
            object2: { type: 'Object', of: { type: { type: 'Object' } } },
            object3: { type: 'Object', of: { prop: { type: 'String' } } },
            array1: { type: 'Array', of: 'String' },
            array2: { type: 'Array', of: 'Reference', model: MainModel },
        });
    });

    it('should support TypeScript sub-models', async () => {
        class SubModel {
            //Empty
        }
        const schema: SchemaData = {
            address: {
                type: 'SubModel',
                model: SubModel,
            },
            nested: {
                type: 'Object',
                of: {
                    address: {
                        type: 'SubModel',
                        model: SubModel,
                    },
                },
            },
        };
        const result = Schema.format(schema);
        expect(result.valid).to.be.true;
        expect(result.schema).to.deep.include(schema);
    });

    it('should reformat nested object rules', async () => {
        const result = Schema.format({
            settings: {
                browser: 'String',
                tags: [String],
                other: {
                    type: 'Array',
                    of: Number,
                },
            },
            address: {
                type: 'Object',
                of: {
                    street: { type: 'String', required: true },
                    num: Number,
                },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        expect(result.schema).to.deep.include({
            settings: {
                type: 'Object',
                of: {
                    browser: { type: 'String' },
                    tags: { type: 'Array', of: 'String' },
                    other: { type: 'Array', of: 'Number' },
                },
            },
            address: {
                type: 'Object',
                of: {
                    street: { type: 'String', required: true },
                    num: { type: 'Number' },
                },
            },
        });
    });

    it('should be able to flatten nested rules', async () => {
        const result = Schema.flatten({
            name: {
                type: 'String',
            },
            address: {
                type: 'Object',
                of: {
                    type: {
                        type: 'String',
                        enum: ['apartment', 'house'],
                    },
                    street: {
                        type: 'String',
                    },
                },
            },
        });
        expect(result).to.deep.include({
            name: { type: 'String' },
            'address.type': { type: 'String', enum: ['apartment', 'house'] },
            'address.street': { type: 'String' },
        });
    });

    it('should prevent invalid field definitions (type, enum, default)', async () => {
        class UnknownType { }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema: any = {
            undefinedType: undefined,
            nullType: null,
            invalidType: UnknownType,
            arrayWithoutType: [],
            invalidArrayType: [UnknownType],
            invalidEnumType: {
                type: 'Boolean',
                enum: [true, false],
            },
            invalidEnumValues: {
                type: 'String',
                enum: [1, 2],
            },
            invalidDefaultValue: {
                type: 'String',
                default: true,
            },
            invalidDefaultFunction: {
                type: 'String',
                default: () => 1 + 1,
            },
            nested: {
                undefinedType: undefined,
                nullType: null,
                invalidType: UnknownType,
            },
        };
        const result = Schema.format(schema);
        // We can't use Schema.flatten() since it's invalid.
        const schemaKeys = Object.keys(schema).slice(0, -1).concat(
            Object.keys(schema.nested).map(e => 'nested.' + e)
        );
        const errorKeys = Object.keys(result.errors);
        expect(schemaKeys).to.have.members(errorKeys);
    });

    it('should prevent invalid config ownerField', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema: any = {
            notAStrOrDoc: 'Boolean',
            private: {
                type: 'String',
                read: 'owner',
            },
        };
        let result = Schema.format(schema, {
            ownerField: true as never,
        });
        expect(result.valid).to.be.false;
        result = Schema.format(schema, {
            ownerField: 'nonexistent',
        });
        expect(result.valid).to.be.false;
        result = Schema.format(schema, {
            ownerField: 'notAStrOrDoc',
        });
        expect(result.valid).to.be.false;
    });

    it('should prevent invalid validation rules', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema: any = {
            // Built-in validation rules.
            invalidBuiltInType: {
                type: 'String',
                min: 1,
            },
            invalidBuiltInMessage: {
                type: 'Number',
                min: [1, true /*'not a string*/],
            },
            invalidBuiltInConstraint: {
                type: 'Number',
                min: 'not-a-number',
            },
            undefinedBuiltInConstraint: {
                type: 'Number',
                min: undefined,
            },
            // Custom in validation rules.
            invalidCustomFormat: {
                type: 'String',
                validate: 'not-an-object',
            },
            invalidCustomValidator: {
                type: 'String',
                validate: {
                    validator: 'not-a-function',
                },
            },
            invalidCustomMessage: {
                type: 'String',
                validate: {
                    validator: (value: number) => value > 1,
                    message: true, // 'Not a function or a string',
                },
            },
        };
        const result = Schema.format(schema);
        expect(Object.keys(result.errors)).to.have.members(Object.keys(schema));
    });

    it('should prevent invalid Collection or Reference', async () => {
        class NoSchema { }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema: any = {
            undefinedRefModel: {
                type: 'Reference',
            },
            invalidRefModel: {
                type: 'Collection',
                model: NoSchema,
            },
            undefinedColModel: {
                type: 'Reference',
            },
            invalidColModel: {
                type: 'Collection',
                model: NoSchema,
            },
        };
        const result = Schema.format(schema);
        expect(Object.keys(result.errors)).to.have.members(Object.keys(schema));
    });

    it('should prevent invalid short syntax', async () => {
        class InvalidType {
            // Empty
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema: any= {
            field1: InvalidType,
            field2: 'InvalidType',
        };
        const result = Schema.format(schema);
        expect(Object.keys(result.errors)).to.have.members(Object.keys(schema));
    });

});
