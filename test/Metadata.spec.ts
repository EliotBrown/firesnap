import { expect } from './utility/chai-setup';
import { Metadata } from '../src/Metadata';
import { Model } from '../src/Model';
import { Schema } from '../src';

describe('Metadata', () => {

    const storage = new Metadata();

    // -------------------------------------------------------------------------
    // Unit Tests
    // ------------------------------------------------------------------------- 

    it('should throw an error when getting to Firestore before init', async () => {
        expect(() => storage.getFirestore()).to.throw(Error);
    });

    it('should throw an error when getting to an invalid schema', async () => {
        class InvalidModel {
            // Empty
        }
        storage.setModelSchema(InvalidModel, {
            invalidRule: {
                type: 'Number',
                minlength: 10,
            },
        });
        expect(() => storage.getModelSchema(InvalidModel)).to.throw(Error);
    });


    it('should dissociate different models with identical names - Part 1/2.', async () => {
        class TestModel {
            // Empty
        }
        storage.setSchemaField(TestModel, 'title', { type: 'String' });
        storage.setSchemaField(TestModel, 'created', { type: 'Date' });
        expect(storage.getModelSchema(TestModel)).to.deep.include({
            title: { type: 'String' },
            created: { type: 'Date' },
        });
    });

    it('should dissociate different models with identical names Part 2/2', async () => {
        // New model with the same name.
        class TestModel {
            // Empty
        }
        storage.setModelSchema(TestModel, {
            other: { type: 'String' },
        });
        expect(storage.models).to.include.keys(['TestModel_1', 'TestModel_2']);
        expect(storage.models.TestModel_1.schema).to.deep.include({
            title: { type: 'String' },
            created: { type: 'Date' },
        });
        expect(storage.models.TestModel_2.schema).to.deep.include({
            other: { type: 'String' },
        });
    });

    // -------------------------------------------------------------------------
    // Integration Tests
    // ------------------------------------------------------------------------- 

    it('should detect and return model constructor metadata', async () => {

        class MainModel extends Model {
            other: string;
            constructor() {
                super();
                this.other = 'test';
            }
            static config = {
                ownerField: 'user',
            };
            static schema = {
                status: {
                    type: 'String',
                    default: 'draft',
                },
            }
            async beforeSave(): Promise<boolean> {
                return true;
            }
        }
        expect(storage.getModelSpecs(MainModel)).to.containSubset({
            primary: true,
            formatted: false,
            config: { path: 'main_models', ownerField: 'user' },
            callbacks: ['beforeSave'],
            defaults: {
                schema: { status: 'draft' },
                instance: { other: 'test' },
            },
        });

        class SubModel {
            country: string;
            constructor() {
                this.country = 'US';
            }
        }
        expect(storage.getModelSpecs(SubModel)).to.containSubset({
            primary: false,
            defaults: { instance: { country: 'US' } },
        });
    });

    it('should handle models without schema or config', async () => {
        class VanillaModel extends Model {
            // Empty
        }
        @Schema({ path: 'custom' })
        class TypeModel extends Model {
            // Empty
        }
        expect(storage.getModelSpecs(VanillaModel).schema).to.be.null;
        expect(VanillaModel.getSchema()).to.be.deep.equal({});
        expect(TypeModel.getConfig()).to.be.deep.equal({
            path: 'custom',
            ownerField: null,
        });
    });



});