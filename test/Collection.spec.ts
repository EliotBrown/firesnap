import { expect, assertRejects } from './utility/chai-setup';
import { Firesnap } from '../src';
import { Post, Comment } from './fixtures/models';
import { Query } from '../src/Query';
import { Collection } from '../src/Collection';
import { initFirestore } from './fixtures/firestore';

describe('Collection', () => {

    let collection: Collection<Post>;
    let post: Post;

    before(async () => {
        const firestore = await initFirestore();
        Firesnap.initialize(firestore);
    });

    beforeEach(() => {
        collection = new Collection(Post);
    });

    // -------------------------------------------------------------------------
    // Unit Tests
    // -------------------------------------------------------------------------

    it('find methods should return typed query instances (GetOne)', async () => {
        expect(collection.find()).to.be.an.instanceOf(Query)
            .with.property('getOne').equal(false);
        expect(collection.findOne()).to.be.an.instanceOf(Query)
            .with.property('getOne').equal(true);
    });

    it('should automatically add children passed as a JSON array', () => {
        const data = [{ name: 'A' }, { name: 'B' }, new Post({})];
        const collection = new Collection(Post, null, data);
        expect(collection).to.have.lengthOf(data.length);
        collection.should.each.be.an.instanceOf(Post);
    });

    it('should prevent from adding invalid children', () => {
        expect(() => collection.push(null)).to.throw(Error);
        expect(() => collection.push('abc')).to.throw(Error);
        expect(() => collection.push([])).to.throw(Error);
        expect(() => collection.push(new Post())).to.not.throw(Error);
        expect(() => collection.push({})).to.not.throw(Error);
    });

    it('should automatically convert children set as JSON', () => {
        collection.push({ content: 'test 1' });
        expect(collection[0]).to.be.an.instanceOf(Post);
        // Test the other side of the rule. 
        collection[0] = new Post({ content: 'test 2' });
        expect(collection[0]).to.be.an.instanceOf(Post);
        expect(collection[0].content).to.be.equal('test 2');
    });

    it('should prevent from deleting root collection', async () => {
        await assertRejects(Collection.delete('not-a-sub'));
    });

    // -------------------------------------------------------------------------
    // Functional Tests
    // -------------------------------------------------------------------------

    it('should create a new document and return a model', async () => {
        post = await collection.add({
            title: 'Collection doc',
            comments: [
                { content: 'comment 1' },
                { content: 'comment 2' },
            ],
        });
        expect(post).to.be.an.instanceOf(Post);
        expect(post.comments).to.be.an.instanceOf(Collection).with.lengthOf(2);
        expect(post.comments.every(e => e.id)).to.be.true;
    });

    it('should add documents in a sub-collection', async function () {
        if (!post || !post.getRef()) {
            this.skip();
        }
        const collection = new Collection(Comment, `${post.getRef().path}/comments`);
        await collection.add({ content: 'comment 3' });
        const results = await collection.find().get();
        expect(results.length).to.be.equal(post.comments.length + 1);
    });


    it('should delete documents of a sub-collection', async function () {
        /**
         * Note: The actual documents deletion is tested via Model.delete() 
         * in the Model spec. Here we are just covering the sub-collection
         * instance method alias. Ex: Post.doc(x).collection('y').delete().
         */
        if (!post || !post.getRef()) {
            this.skip();
        }
        const collection = new Collection(Comment, `${post.getRef().path}/comments`);
        // With a session.
        const batch = Firesnap.batch();
        await collection.delete({ session: batch });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((batch as any)._ops).to.not.be.empty;
        expect(await collection.find().get()).to.not.be.empty;
        // Without a session.
        await collection.delete();
        expect(await collection.find().get()).to.be.empty;
    });

    



});