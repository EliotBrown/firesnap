import { assertRejects, expect, sinon } from './utility/chai-setup';
import { initFirestore } from './fixtures/firestore';
import { Firesnap } from '../src';
import { Query } from '../src/Query';
import { Post, User, Topic } from './fixtures/models';
import { Firestore, QuerySnapshot } from '@google-cloud/firestore';
import { Importer } from './utility/Importer';

describe('Query', () => {

    let skipNext = false;
    let firestore: Firestore;
    let query: Query<Post>;

    before(async () => {
        firestore = await initFirestore();
        Firesnap.initialize(firestore, {
            getOptions: {
                returnAsJSON: true,
                returnAllFields: true,
            },
        });
    });

    beforeEach(function () {
        query = new Query(Post);
        if (skipNext) {
            this.skip();
        }
    });

    const compareResults = ((res1: QuerySnapshot, res2: Post[], ordered = false) => {
        expect(res1.size, 'The data sample doesn\'t have enough docs matching this query (5 min)').to.be.gte(5);
        expect(res2.length).to.be.equal(res1.size);
        const ids1 = res1.docs.map((doc) => doc.id);
        const ids2 = res2.map((doc) => doc.id);
        if (ordered) {
            expect(ids1).to.be.deep.equal(ids2);
        } else {
            expect(ids1).to.have.members(ids2);
        }
    });

    // -------------------------------------------------------------------------
    // Unit Tests
    // -------------------------------------------------------------------------

    it('should reformat sort() arg passed as string (+id field)', () => {
        expect(query.sort('name')).to.containSubset({
            query: { sort: { name: 'asc' } },
        });
        expect(query.sort('id')).to.containSubset({
            query: { sort: { __name__: 'asc' } },
        });
    });

    it('should reformat select() arg passed as string', () => {
        expect(query.select('name, age')).to.containSubset({
            query: {
                fields: ['name', 'age'],
            },
        });
    });

    it('should reformat populate() short arg syntaxes', () => {
        expect(query.populate('user')).to.containSubset({
            query: { populate: { user: { fields: null } } },
        });
        expect(query.populate('user,comments')).to.containSubset({
            query: { populate: { user: { fields: null }, comments: { fields: null } } },
        });
        expect(query.populate({ user: 'name' })).to.containSubset({
            query: { populate: { user: { fields: ['name'] } } },
        });
        expect(query.populate({ user: ['name'] })).to.containSubset({
            query: { populate: { user: { fields: ['name'] } } },
        });
        expect(query.populate({ user: { fields: 'name' } })).to.containSubset({
            query: { populate: { user: { fields: ['name'] } } },
        });
        expect(query.populate({ comments: { limit: 1 } })).to.containSubset({
            query: { populate: { comments: { limit: 1, fields: null } } },
        });
        // Auto populate ref & collection added as a field.
        expect(query.populate({ comments: 'date,user,likes' })).to.containSubset({
            query: {
                populate: {
                    comments: {
                        fields: ['date'],
                        populate: {
                            user: { fields: null },
                            likes: { fields: null },
                        },
                    },
                },
            },
        });
    });

    it('should prevent invalid populate() values', async () => {
        // The field 'test' is not defined in the Post schema.
        expect(() => query.populate('test')).to.throw(Error);
        // The field 'title' exists but is not a Collection or Model.
        expect(() => query.populate('title')).to.throw(Error);
        // Mixed 'fields' value types.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => query.populate(['comments', {}] as any)).to.throw(Error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => query.populate({ comments: ['user', {}] } as any)).to.throw(Error);
    });

    it('should throw an error when passing an invalid session', async () => {
        query.limit(1); // If the test fail, we keep the test data.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const options = { session: 'not-null-not-false' } as any;
        await assertRejects(query.get(options));
        await assertRejects(query.update({}, options));
        await assertRejects(query.delete(options));
    });

    it('should prevent from using invalid operator', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await assertRejects(Post.find({ title: { $invalid: 'value' } } as any).get());
    });

    // -------------------------------------------------------------------------
    // Functional Tests
    // -------------------------------------------------------------------------

    if (process.env['DATA_INSERTED']) {
        it('Data already inserted', () => {
            // Empty
        });
    } else {
        it('Insert sample of data ~300 rows', async () => {
            const importer = new Importer(firestore, {
                prefix: 'test_',
                autoId: true,
            });
            const res = await importer.process('test/fixtures/data.json');
            if (!res) {
                skipNext = true;
            }
            expect(res.length).to.be.greaterThan(200);
            process.env['DATA_INSERTED'] = 'true';
        });
    }

    it('pagination methods should throw an error if the cursor is invalid', async () => {
        const query = new Query(Post);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => (query as any).after([])).to.throw(Error);
        expect(() => query.after(Post.ref('post-1'))).to.throw(Error);
        expect(() => query.after(new Post())).to.throw(Error);
        const topic = await Topic.findOne().get({ returnAsJSON: false });
        expect(topic).to.be.an.instanceOf(Topic);
        expect(() => query.after(topic)).to.throw(Error);
    });

    it('populate() should cache redundant references', async () => {
        const query = Post.find({ user: User.ref('user-1'), topics: { $ac: Topic.ref('topic-1') } })
            .populate('user,topics').limit(2);
        const posts = await query.get();
        expect(posts.length, 'Not enough docs match the query for this test')
            .to.be.eq(2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((query as any).cache)
            .to.include.keys(['test_users/user-1', 'test_topics/topic-1']);
    });

    it('should filter results using implicit operator \'==\'', async () => {
        compareResults(
            await firestore.collection('test_posts')
                .where('status', '==', 'published')
                .limit(10)
                .get()
            ,
            await Post.find({ status: 'published' })
                .limit(10)
                .get()
        );
    });

    it('should filter results using operators (\'$eq\', \'$in\', \'$gt\' and \'$lt\')', async () => {
        const conditions = {
            visibility: { $eq: 'public' },
            voteCount: { $gt: 10, $lt: 80 },
            status: { $in: ['draft', 'published'] },
        };
        compareResults(
            await firestore.collection('test_posts')
                .where('visibility', '==', conditions.visibility.$eq)
                .where('voteCount', '>', conditions.voteCount.$gt)
                .where('voteCount', '<', conditions.voteCount.$lt)
                .where('status', 'in', conditions.status.$in)
                .get()
            ,
            await Post.find(conditions)
                .get()
        );
    });

    it('should filter results using operators (\'$lte\', \'$gte\' and \'$aca\')', async () => {
        const conditions = {
            voteCount: { $gte: 40, $lte: 50 },
            tags: { $aca: ['tag1', 'tag2'] },
        };
        compareResults(
            await firestore.collection('test_posts')
                .where('voteCount', '>=', conditions.voteCount.$gte)
                .where('voteCount', '<=', conditions.voteCount.$lte)
                .where('tags', 'array-contains-any', conditions.tags.$aca)
                .get()
            ,
            await Post.find(conditions)
                .get()
        );
    });

    it('should filter results using operators (\'$ne\')', async () => {
        compareResults(
            await firestore.collection('test_posts')
                .where('status', '!=', 'published')
                .limit(10)
                .get()
            ,
            await Post.find({ status: { $ne: 'published' } })
                .limit(10)
                .get()
        );
    });

    it('should filter results using operators (\'$ac and $nin\')', async () => {
        const conditions = {
            tags: { $ac: 'tag1' },
            status: { $nin: ['published', 'draft'] },
        };
        compareResults(
            await firestore.collection('test_posts')
                .where('tags', 'array-contains', conditions.tags.$ac)
                .where('status', 'not-in', conditions.status.$nin)
                .get()
            ,
            await Post.find(conditions)
                .get()
        );
    });

    it('should limit and sort the results (\'asc\' and \'desc\')', async () => {
        compareResults(
            await firestore.collection('test_posts')
                .orderBy('voteCount', 'desc')
                .orderBy('title')
                .limit(10)
                .get()
            ,
            await Post.find()
                .sort({ voteCount: 'desc', title: 'asc' })
                .limit(10)
                .get()
        );
    });

    it('should select only specific fields and populate data', async () => {
        const res = await Post.find({ commentCount: { $gt: 0 } })
            .select(['id', 'title'])
            .populate({
                user: 'id, displayName',
                comments: {
                    fields: ['content'],
                    populate: {
                        user: ['displayName'],
                    },
                    limit: 1,
                },
            })
            .limit(1)
            .get({
                returnAsJSON: true,
                returnAllFields: false,
            });
        expect(res.length).to.be.greaterThan(0);
        expect(res[0]).to.have.all.keys('id', 'title', 'user', 'comments');
        expect(res[0].user).to.have.all.keys('id', 'displayName');
        expect(res[0].comments).to.be.an('array').with.lengthOf(1);
        expect(res[0].comments[0]).to.have.all.keys('content', 'user');
        expect(res[0].comments[0].user).to.have.all.keys('displayName');
    });

    it('should filter by reference (implicit and operator)', async () => {
        const fireRes = await firestore.collection('test_posts')
            .where('user', '==', firestore.doc('test_users/user-1'))
            .limit(5)
            .get();
        compareResults(
            fireRes,
            await Post.find({ user: User.ref('user-1') })
                .limit(5)
                .get()
        );
        compareResults(
            fireRes,
            await Post.find({ user: { $eq: User.ref('user-1') } })
                .limit(5)
                .get()
        );
    });

    it('should skip results before a specific value or model instance.', async () => {
        /**
         * Note: We use the field "approved" to avoid docs created by other test files.
         */
        const i = 1;
        let res2: Post[];
        const res1 = await Post.find({ approved: true }).sort('title').limit(5).get({
            returnAsJSON: false,
        });
        expect(res1.length, 'Not enough docs for this test').to.be.gte(5);

        // Paginate with value (after & startAt).
        res2 = await Post.find({ approved: true }).after(res1[i].title).sort('title').limit(1).get();
        expect(res2.length).to.be.equal(1);
        expect(res2[0].id, 'after() failed').to.be.equal(res1[i + 1].id);

        res2 = await Post.find({ approved: true }).startAt(res1[i].title).sort('title').limit(1).get();
        expect(res2.length).to.be.equal(1);
        expect(res2[0].id, 'startAt() failed').to.be.equal(res1[i].id);

        // Paginate with model instance.
        res2 = await Post.find({ approved: true }).after(res1[i]).sort('title').limit(1).get();
        expect(res2.length).to.be.equal(1);
        expect(res2[0].id, 'after() with model failed').to.be.equal(res1[i + 1].id);
    });

    it('should exclude results after a specific value or model instance.', async () => {
        /**
         * Note: Firestore methods endBefore() and endAt() just exclude the result after 
         * the value and can not be used as a cursor. 
         * Note: We use the field "approved" to avoid docs created by other test files.
         */
        const i = 3;
        let res2: Post[];
        const res1 = await Post.find({ approved: true }).sort('title').limit(5).get({ returnAsJSON: false });
        expect(res1.length, 'Not enough docs for this test').to.be.gte(5);

        // Restrict by value (endBefore & endAt).
        res2 = await Post.find({ approved: true }).endBefore(res1[i].title).sort('title').limit(res1.length).get();
        expect(res2.length, 'endBefore() failed (no res)').to.be.gte(1);
        expect(res2[res2.length - 1].id, 'endBefore() failed').to.be.equal(res1[i - 1].id);

        res2 = await Post.find({ approved: true }).endAt(res1[i].title).sort('title').limit(res1.length).get();
        expect(res2.length, 'endAt() failed (no res)').to.be.gte(1);
        expect(res2[res2.length - 1].id, 'endAt() failed').to.be.equal(res1[i].id);

        // Restrict with model instance.
        res2 = await Post.find({ approved: true }).endAt(res1[i]).sort('title').limit(res1.length).get();
        expect(res2.length, 'endAt() with model failed (no res)').to.be.gte(1);
        expect(res2[res2.length - 1].id, 'endAt() with model failed').to.be.equal(res1[i].id);
    });

    it('should update multiple documents', async () => {
        const limit = 2;
        const val = 'title-' + Date.now();
        let res = await Post.find().limit(limit).get();
        expect(res.length, 'Not enough docs for this test').to.be.eq(limit);
        const ids = res.map(e => e.id);
        await Post.find({ id: { $in: ids } }).update({ title: val });
        res = await Post.find({ id: { $in: ids } }).get();
        res.should.each.have.property('title').that.is.equal(val);
    });

    it('should delete multiple documents', async () => {
        const limit = 2;
        let res = await Post.find().limit(limit).get();
        expect(res.length, 'Not enough docs for this test').to.be.eq(limit);
        const ids = res.map(e => e.id);
        await Post.find({ id: { $in: ids } }).delete();
        res = await Post.find({ id: { $in: ids } }).get();
        expect(res.length).to.be.eq(0);
    });

    it('update() and delete() should not auto commit within a batch', async () => {
        const docs = await Post.find({ approved: true }).limit(2).get();
        expect(docs, 'This test requires at least 1 doc').to.not.be.empty;
        let batch = Firesnap.batch();
        await Post.find().limit(1).update({ approved: false }, { session: batch, validate: false });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((batch as any)._ops).to.not.be.empty;
        batch = Firesnap.batch();
        await Post.find({ approved: true }).limit(1).delete({ session: batch });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((batch as any)._ops).to.not.be.empty;
    });

    it('update() should bypass model instantiation if unnecessary ', async () => {
        const val = 'title-' + Date.now();
        let docs = await Post.find({ approved: true }).limit(1).get();
        expect(docs, 'This test requires at least 1 doc').to.not.be.empty;
        const ids = docs.map(e => e.id);
        // No callbacks no references to update.
        const query = new Query(Post, false, { id: { $in: ids } });
        const spy = sinon.spy(query, 'get');
        await query.update({ title: val }, { callbacks: false });
        expect(spy.args[0][0].returnAsJSON).to.be.true;
        docs = await query.get();
        docs.should.each.have.property('title').that.is.equal(val);
        // No callbacks but references to update.
        spy.resetHistory();
        await query.update({ user: { displayName: 'New Name' } }, { callbacks: false });
        expect(spy.args[0][0].returnAsJSON).to.be.false;
        // No callbacks no references with error.
        await assertRejects(query.update({ title: true }, { callbacks: false }));
        // No callbacks no references with empty data.
        await assertRejects(query.update({ 'no-in-schema': true }, { callbacks: false }));
    });

    it('delete() should bypass model instantiation if unnecessary ', async () => {
        // No callbacks no sub-collections.
        const ids = [];
        for (let i = 1; i < 3; i++) {
            ids.push('tmp-' + i);
            await Topic.doc('tmp-' + i).set({ name: 'Test' + 1 });
        }
        const query = new Query(Topic, false, { id: { $in: ids } });
        let res = await query.get();
        expect(res.length).to.be.equal(ids.length);
        const spy = sinon.spy(query, 'get');
        await query.delete({ callbacks: false });
        expect(spy.args[0][0].returnAsJSON).to.be.true;
        res = await query.get();
        expect(res).to.be.empty;
        // No callbacks but sub-collections.
        const query2 = new Query(Post, false).limit(1);
        const spy2 = sinon.spy(query2, 'get');
        await query2.delete({ callbacks: false });
        expect(spy2.args[0][0].returnAsJSON).to.be.false;
    });

    it('update() and delete() handle existing transaction', async () => {
        let spiedArg = {};
        const query = Post.find({ approved: true }).limit(1);
        const docs = await query.get();
        expect(docs, 'This test requires at least 1 doc').to.not.be.empty;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sinon.stub(query as any, 'get').callsFake((options) => {
            spiedArg = options;
            return [];
        });
        await Firesnap.transaction(async txn => {
            await query.update({ approved: false }, { session: txn });
            expect(spiedArg).property('session').to.exist;
            spiedArg = {};
            await query.delete({ session: txn });
            expect(spiedArg).property('session').to.exist;
        });
    });

    it('get() should be able to run in a transaction', async () => {
        let txnGetCalled = false;
        await Firesnap.transaction(async txn => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sinon.stub(txn as any, 'get').callsFake(() => {
                txnGetCalled = true;
                return { size: 0, docs: [] };
            });
            await Post.find().limit(1).get({ session: txn });
            expect(txnGetCalled).to.be.true;
        });
    });

});