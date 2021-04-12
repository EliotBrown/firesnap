import { expect } from './utility/chai-setup';
import { Validator } from '../src/Validator';
import { Collection } from '../src/Collection';
import { Model, Field, FieldValue } from '../src';
import { SchemaData } from '../src/types';

describe('Validator', () => {

    // -------------------------------------------------------------------------
    // Unit Tests
    // ------------------------------------------------------------------------- 

    it('should check simple value types', async () => {
        const schema: SchemaData = {
            title: { type: 'String' },
            count: { type: 'Number' },
            tags: { type: 'Array', of: 'String' },
            approved: { type: 'Boolean' },
            config: { type: 'Object', of: {} },
        };
        const invalid = {
            title: true,
            count: 'string',
            tags: [1, 2],
            approved: 1,
            config: 'string',
        };
        let result = await Validator.check(schema, invalid);
        if (result.errors['tags[0]']) {
            result.errors.tags = result.errors['tags[0]'];
            delete result.errors['tags[0]'];
        }
        expect(Object.keys(result.errors)).to.have.members(Object.keys(schema));
        result = await Validator.check(schema, {
            title: 'string',
            count: 2,
            tags: ['string'],
            approved: true,
            config: {},
        });
        expect(result.valid).to.be.true;
    });

    it('should check built in rules (min, max, length, url, email)', async () => {
        const schema = {
            title: {
                minlength: 3,
                maxlength: 6,
                required: true,
            },
            rating: {
                min: 1,
                max: 5,
            },
            website: {
                url: true,
            },
            email: {
                email: true,
            },
        };
        // minlength/maxlength
        expect(await Validator.check(schema, { title: '1' }), 'minlength')
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { title: 'more than 5' }), 'maxlength')
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { title: 'just 5' }), 'valid length')
            .property('valid').to.be.true;
        // min/max
        expect(await Validator.check(schema, { rating: 0 }), 'min')
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { rating: 6 }), 'max')
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { rating: 1 }), 'valid number')
            .property('valid').to.be.true;
        // email
        expect(await Validator.check(schema, { email: 'test@test' }), 'invalid email')
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { email: 'test@gmail.com' }), 'valid email')
            .property('valid').to.be.true;
        // url
        expect(await Validator.check(schema, { website: 'test/test' }), 'invalid url')
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { website: 'http://google.com' }), 'valid url')
            .property('valid').to.be.true;
    });

    it('should check required fields for new documents', async () => {
        const schema: SchemaData = {
            field1: {
                required: true,
            },
            field2: {
                required: [true, 'Required with message'],
            },
        };
        expect(await Validator.check(schema, {}, { newDocument: true }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { field1: 'a' }, { newDocument: true }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, {}))
            .property('valid').to.be.true;
        expect(await Validator.check(schema, { field1: 'a', field2: 'b' }, { newDocument: true }))
            .property('valid').to.be.true;
    });

    it('should check [write:admin] rule', async () => {
        const schema: SchemaData = {
            token: {
                write: 'admin',
            },
        };
        expect(await Validator.check(schema, { token: 'any' }, { authValue: '123' }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { token: 'any' }, { authValue: true }))
            .property('valid').to.be.true;
    });

    it('should check enum rule', async () => {
        const schema = {
            status: {
                enum: ['active', 'pending'],
            },
        };
        expect(await Validator.check(schema, { status: 'test' }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { status: 'active' }))
            .property('valid').to.be.true;
    });

    it('should check custom validation rule', async () => {
        const schema = {
            phone: {
                validate: {
                    validator: (value: string) => /\d{3}-\d{3}-\d{4}/.test(value),
                },
            },
        };
        expect(await Validator.check(schema, { phone: '123-456-18' }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { phone: '123-456-7890' }))
            .property('valid').to.be.true;
    });

    it('should handle custom message for built-in and required rules', async () => {
        const schema: SchemaData = {
            rating: {
                min: [10, '10 minimum'],
                required: [true, 'enter status'],
            },
        };
        expect(await Validator.check(schema, { rating: 9 }))
            .property('errors')
            .property('rating').to.be.equal(schema.rating.min[1]);
        expect(await Validator.check(schema, {}, { newDocument: true }))
            .property('errors')
            .property('rating').to.be.equal(schema.rating.required[1]);
    });

    it('should handle custom error message for custom validation rule', async () => {
        const schema: SchemaData = {
            title: {
                validate: {
                    validator: (value: number) => value > 5,
                    message: 'title to short',
                },
            },
            rating: {
                validate: {
                    validator: (value: number) => value > 1,
                    message: (field) => `${field.name}_${field.value}`,
                },
            },
        };
        expect(await Validator.check(schema, { rating: 1 }))
            .property('errors')
            .property('rating').to.be.equal('rating_1');
        expect(await Validator.check(schema, { title: 'abc' }))
            .property('errors')
            .property('title').to.be.equal(schema.title.validate.message);
    });

    it('should bypass rules with custom message set to false (email, url and required)', async () => {
        const schema: SchemaData = {
            title: {
                required: [false, 'message'],
            },
            other: {
                email: [false, 'message'],
                url: [false, 'message'],
            },
        };
        expect(await Validator.check(schema, { other: 'abc' }, { newDocument: true }))
            .property('valid').to.be.true;
    });

    it('should exclude fields not defined in the schema from the returned data', async () => {
        const schema: SchemaData  = {
            title: {
                type: 'String',
            },
        };
        expect(await Validator.check(schema, { title: 'abc', other: 123 }))
            .property('data').to.not.have.property('other');
    });

    it('should check null/undefined value (+combined with required)', async () => {
        const schema: SchemaData  = {
            title: {
                type: 'String',
            },
            other: {
                null: true,
                required: true,
            },
        };
        expect(await Validator.check(schema, { title: null }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { other: undefined }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { other: null }))
            .property('valid').to.be.true;
        expect(await Validator.check(schema, { other: null }, { newDocument: true }))
            .property('valid').to.be.true;
    });

    it('should check nested object rules', async () => {
        const schema: SchemaData  = {
            address: {
                type: 'Object',
                of: {
                    street: {
                        type: 'String',
                        minlength: 5,
                    },
                },
            },
        };
        expect(await Validator.check(schema, { address: { street: 'abc' } }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { address: { street: 'abcde' } }))
            .property('valid').to.be.true;
        expect(await Validator.check(schema, { address: { street: [1, 2] } }))
            .property('valid').to.be.false;
    });


    it('should check Reference Collection & array of References', async () => {
        class DiffModel extends Model {
            static schema: SchemaData = {
                name: { type: 'String' },
            }
        }
        class SubModel extends Model {
            static schema: SchemaData = {
                name: { type: 'String', required: true },
            }
        }
        const schema:SchemaData = {
            mainTopic: {
                type: 'Reference',
                model: SubModel,
            },
            topics: {
                type: 'Array',
                of: 'Reference',
                model: SubModel,
            },
            comments: {
                type: 'Collection',
                model: SubModel,
            },
        };
        // Single reference .
        expect(await Validator.check(schema, { mainTopic: new SubModel() }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { mainTopic: new SubModel({ name: true }) }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { mainTopic: new DiffModel({ name: 'abc' }) }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { mainTopic: new SubModel({ name: 'abc' }) }))
            .property('valid').to.be.true;
        // Array of references.
        expect(await Validator.check(schema, { topics: [1, 2] }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { topics: [new SubModel()] }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { topics: [new DiffModel({ name: 'abc' })] }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { topics: [new SubModel({ name: 'abc' })] }))
            .property('valid').to.be.true;
        // Sub-collection.
        expect(await Validator.check(schema, { comments: [new SubModel({ name: 'abc' })] }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { comments: new Collection(SubModel, null, [{ name: true }]) }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { comments: new Collection(DiffModel, null, [{ name: 'abc' }]) }))
            .property('valid').to.be.false;
        expect(await Validator.check(schema, { comments: new Collection(SubModel, null, [{ name: 'abc' }]) }))
            .property('valid').to.be.true;
    });

    // -------------------------------------------------------------------------
    // Integration Tests
    // ------------------------------------------------------------------------- 

    it('should check nested model rules', async () => {
        class SubWithSchema {
            @Field()
            field: string;
        }
        class SubNoSchema {
            field: string;
        }
        const schema: SchemaData = {
            nested1: {
                type: 'SubModel',
                model: SubWithSchema,
            },
            nested2: {
                type: 'SubModel',
                model: SubNoSchema,
            },
        };
        const data = {
            nested1: new SubWithSchema(),
            nested2: new SubNoSchema(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.nested1.field as any) = true;
        expect(await Validator.check(schema, data)).property('valid').to.be.false;
        data.nested1.field = 'test';
        expect(await Validator.check(schema, data)).property('valid').to.be.true;
        data.nested2.field = null;
        expect(await Validator.check(schema, data)).property('valid').to.be.true;
    });

    it('should bypass Firestore Transform field values ', async () => {
        const schema: SchemaData = {
            title: {
                type: 'String',
            },
            count: {
                type: 'Number',
            },
        };
        const result = await Validator.check(schema, {
            title: FieldValue.increment(1),
            count: FieldValue.delete(),
        });
        expect(result.valid).to.be.true;
    });
});