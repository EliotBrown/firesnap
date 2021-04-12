import { expect, sinon } from './utility/chai-setup';
import { Collection, Field, Firesnap, GetOptions, Model } from '../src';
import { initFirestore } from './fixtures/firestore';
import { Document } from '../src/Document';
import { Query } from '../src/Query';
import { Collection as CollectionClass} from '../src/Collection';

describe('Document', () => {
    class ChildModel extends Model { 
    }
    class TestModel extends Model {
        @Field() prop: string;
        @Collection(ChildModel) children: ChildModel[];
    }
    const docId = 'id-' + Date.now();
    const propVal = 'init-' + Date.now();
    const options: Partial<GetOptions> = {
        returnAllFields: true,
        returnAsJSON: true,
        populatePrimaryKey:false,
    };
    let document: Document<TestModel> = null;
    let blankDoc: Document<TestModel> = null;

    beforeEach(() => {
        blankDoc = new Document<TestModel>(TestModel, docId);
    });

    before(async () => {
        const firestore = await initFirestore();
        Firesnap.initialize(firestore);
        document = new Document<TestModel>(TestModel, docId);
    });

    // -------------------------------------------------------------------------
    // Unit Tests
    // ------------------------------------------------------------------------- 

    it('should throw an error when constructed without a valid document id', async () => {
        expect(() => new Document(TestModel, '')).to.throw(Error);
    });

    it('select() and populate() should be chainable and return an updated query, ', async () => {
        const subset = { query: { fields: ['prop'], populate: { children: { fields: null } } } };
        let query = blankDoc.select('prop').populate('children');
        expect(query).to.be.an.instanceOf(Query);
        expect(query).to.containSubset(subset);
        query = blankDoc.populate('children').select('prop');
        expect(query).to.be.an.instanceOf(Query);
        expect(query).to.containSubset(subset);
    });

    it('query() should return existing Query or instantiate a new one with the doc id, ', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((blankDoc as any).query).to.be.an.instanceOf(Query);
        blankDoc.select('prop');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((blankDoc as any).query).to.containSubset({
            query: {
                where: { __name__: docId },
                fields: ['prop'],
            },
        });
    });

    it('auth() should return the current instance and affect the query', async () => {
        const updated = blankDoc.auth(true);
        expect(updated).to.be.equal(blankDoc);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((blankDoc as any).query).to.containSubset({ query: { auth: true } });
    });

    it('get() should execute the current query', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stub = sinon.stub((blankDoc as any).query, 'get');
        await blankDoc.get();
        sinon.assert.calledOnce(stub);
    });

    it('collection() should return an instance of a Collection or throw an error', async () => {
        expect(() => blankDoc.collection('prop')).to.throw(Error);
        expect(() => document.collection('random')).to.throw(Error);
        expect(blankDoc.collection('children')).to.be.an.instanceOf(CollectionClass);
    });

    // -------------------------------------------------------------------------
    // Functional Tests
    // ------------------------------------------------------------------------- 

    it('should create a document with a specific Id', async function () {
        await document.set({ prop: propVal }, { validate: false });
    });

    it('should get a document by Id ', async function () {
        expect(await document.get(options)).property('prop').to.equals(propVal);
    });

    it('should update a document by Id', async function () {
        const value = 'update-' + Date.now();
        await document.update({ other: value }, { validate: false });
        expect(await document.get(options)).to.deep.include({ prop: propVal, other: value });
        // Call the function without options.
        await document.update({ other: value });
    });

    it('should update instead of set if the merge option is true', async function () {
        const update = sinon.stub(document, 'update');
        document.set({}, { merge: true });
        sinon.assert.calledOnce(update);
    });

    it('should overwrite a document by Id', async function () {
        const value = 'reset-' + Date.now();
        expect(await document.get(options), 'Invalid doc').property('prop').to.equals(propVal);
        await document.set({ other: value }, { validate: false });
        expect(await document.get(options)).to.deep.include({ other: value });
        // Call the function without options.
        await document.set({ other: value });
    });

    it('should delete a document by Id', async function () {
        expect(await document.delete()).to.be.true;
        expect(await document.get()).to.be.null;
    });

});



