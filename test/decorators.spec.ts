import { expect, sinon } from './utility/chai-setup';
import { Field, Model } from '../src';
import { Storage } from '../src/Metadata';

describe('Decorators', () => {

    let setFieldSpy: sinon.SinonSpy;

    const getSpiedTypes = (() => {
        const types = {};
        setFieldSpy.args.forEach(arg => {
            types[arg[1]] = arg[2];
        });
        return types;
    });

    before(() => {
        setFieldSpy = sinon.spy(Storage, 'setSchemaField');
    });

    beforeEach(() => {
        setFieldSpy.resetHistory();
    });

    after(() => {
        setFieldSpy.restore();
    });

    // -------------------------------------------------------------------------
    // Unit Tests
    // -------------------------------------------------------------------------

    it('Field() should retrieve the type from the metadata', async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        class TestModel {
            @Field() title: string;
        }
        expect(getSpiedTypes()).to.deep.include({
            title: { type: 'String' },
        });
    });

    it('Field() should retrieve the type from default values', async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        class TestModel {
            @Field() title = 'default val';
            @Field() tags = ['tags'];
            @Field() date = Date.now;
            @Field() notNull: string = null;
            @Field() func = () => true;
            @Field() void = () => { 1 + 2; };
        }
        expect(getSpiedTypes()).to.deep.include({
            title: { type: 'String' },
            tags: { type: 'Array', of: String },
            date: { type: 'Date' },
            notNull: { type: 'String' },
            func: { type: 'Boolean' },
            void: { type: 'Undefined' },
        });
    });

    it('Field() should detect references & nested fields ', async () => {
        class NestedField {
            @Field() nested: NestedField;
        }
        class Reference extends Model {
            @Field() any: string;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        class TestModel {
            @Field() nested: NestedField
            @Field() ref: Reference;
            @Field({ of: Reference }) arr: Reference[];
        }
        expect(getSpiedTypes()).to.deep.include({
            nested: { model: NestedField, type: 'SubModel' },
            ref: { model: Reference, type: 'Reference' },
            arr: { model: Reference, type: 'Array', of: 'Reference' },
        });
    });


});