import { expect, assertRejects, assertResolves, sinon } from './utility/chai-setup';
import { Field, Firesnap, Model, Schema } from '../src';
import { Collection } from '../src/Collection';
import { Storage } from '../src/Metadata';
import { initFirestore } from './fixtures/firestore';
import { ValidationError } from '../src/Validator';
import { Post, Comment, User, Topic, Like } from './fixtures/models';
import { constructorName } from '../src/utils';

describe('Model', () => {

    let post: Post = null;
    let txnPost: Post = null;

    before(async () => {
        const firestore = await initFirestore();
        Firesnap.initialize(firestore, {
            primaryKeyName: 'id',
            getOptions: {
                populatePrimaryKey: true,
            },
        });
    });

    // -------------------------------------------------------------------------
    // Unit Tests
    // -------------------------------------------------------------------------

    it('should handle optional method options', async () => {
        class TestModel extends Model {
            // Empty
        }
        const find = sinon.spy(TestModel.collection(), 'find');
        const add = sinon.spy(TestModel.collection(), 'add');
        const findOne = sinon.spy(TestModel.collection(), 'findOne');
        TestModel.find();
        TestModel.findOne();
        TestModel.create({});
        expect(add.calledWith({}, {})).to.be.true;
        expect(find.calledWith({})).to.be.true;
        expect(findOne.calledWith({})).to.be.true;
    });

    // -------------------------------------------------------------------------
    // Integration Tests
    // -------------------------------------------------------------------------

    it('should define a schema using static properties', async () => {
        class Vanilla extends Model {
            static config = {
                ownerField: 'user',
            }
            static schema = {
                title: String,
            }
        }
        expect(Vanilla.getConfig()).property('ownerField').to.be.eq('user');
        expect(Vanilla.getSchema()).to.have.key('title');
    });

    it('should define a schema using decorators', async () => {
        @Schema({ ownerField: 'user' })
        class TypeModel extends Model {
            @Field() title: string;
        }
        expect(TypeModel.getConfig()).property('ownerField').to.be.eq('user');
        expect(TypeModel.getSchema()).to.have.key('title');
    });

    it('should be able to be converted to JSON', () => {
        const post = new Post({
            title: 'test',
            user: new User({ displayName: 'John' }),
            createdAt: new Date(),
            topics: [new Topic({ name: 'Test 1' })],
            comments: new Collection(Comment, null, [
                new Comment({ content: 'test', date: new Date() }),
                new Comment({ content: 'test', date: new Date() }),
            ]),
        });
        expect(post.toData()).to.be.an.instanceOf(Object);
    });

    it('should prevent from overwriting own methods', () => {
        const post = new Post();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (post as any).save = 'test';
        expect(post.save).to.be.a('function');
    });

    it('should automatically convert strings/arrays to objects based on the schema', () => {
        let object = new Post({
            user: 'user-id',
            topics: [
                'topic-1',
                Topic.ref('topic-2'),
                { name: 'new topic' },
            ],
            comments: [
                { content: 'test' },
                { content: 'test' },
            ],
            createdAt: '2020-01-01',
        });
        expect(object.user).to.be.an.instanceOf(User);
        expect(object.createdAt).to.be.an.instanceOf(Date);
        expect(object.comments).to.be.an.instanceOf(Collection);
        expect(object.comments.length).to.be.equal(2);
        object.comments.should.each.be.an.instanceOf(Comment);
        expect(object.topics.length).to.be.equal(3);
        object.topics.should.each.be.an.instanceOf(Topic);
        // Reference as a JSON object.
        object = new Post({
            user: { displayName: 'New User' },
        });
        expect(object.user).to.be.an.instanceOf(User);
        // Invalid values.
        object = new Post({
            createdAt: 'invalid-date',
            user: [],
        });
        expect(object.createdAt).to.be.a('string');
        expect(object.user).to.be.eql([]);
    });

    it('should automatically convert deleted fields', () => {
        const post = new Post({
            title: 'Test',
        });
        delete post.title;
        delete post.tags;
        const changes = post[Symbol.for('changes')];
        expect(constructorName(changes.title)).to.be.eq('DeleteTransform');
        expect(changes).to.not.have.property('tags');
    });

    it('should track property changes (nested objects. + saving)', async () => {
        /**
         * Note: Sub-collection & reference changes, will not reflect in the main 
         * object changes since they are being saved separately. Only object & SubModel fields. 
         */
        const batch = Firesnap.batch();
        const user = new User({
            displayName: 'track changes',
            address: {
                zipcode: '10000',
                location: {
                    lat: 1,
                    lon: 1,
                },
            },
        });
        // Should be set before the commit.
        await user.save({ validate: false, callbacks: false, session: batch });
        expect(user[Symbol.for('changes')]).to.not.be.empty;

        // Should be empty after save.
        await batch.commit();
        expect(user[Symbol.for('changes')]).be.empty;

        // Should bet empty we delete a prop that doesn't exist.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (user.address as any).fakeProp;
        expect(user[Symbol.for('changes')]).be.empty;

        // Should set if we add a new property.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (user.address as any).newProp = 1;
        expect(user[Symbol.for('changes')]).to.not.be.empty;

        // Should be set if we delete an existing prop.
        delete user.address.zipcode;
        expect(user[Symbol.for('changes')]).to.not.be.empty;

        // Should be set if we change an existing prop value.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (user as any).resetChanges();
        user.address.zipcode = 'new val';
        expect(user[Symbol.for('changes')]).to.not.be.empty;
    });

    it('should throw an error when trying to save invalid values', async () => {
        // The Post model has the field title set to String.
        let error = null;
        try {
            await new Post({ title: [1] }).save({ validate: true });
        } catch (e) {
            error = e;
        }
        expect(error).to.be.an.instanceOf(ValidationError)
            .and.property('fields')
            .property('title').to.be.a('string');
    });

    it('should not save or delete empty documents', async () => {
        // Use a batch in order to track the operations.
        class NodDefaultValues extends Model {
            @Field() title: string;
        }
        const batch = Firesnap.batch();
        const model = new NodDefaultValues();
        let success: boolean;
        success = await model.save({ validate: false, session: batch });
        expect(success).to.be.false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((batch as any)._ops).to.be.empty;
        success = await model.delete();
        expect(success).to.be.false;
    });

    it('should auto instantiate sub-models recursively', async () => {
        class SubModel2 {
            @Field() field: string;
        }
        class SubModel1 {
            @Field() sub2: SubModel2;
        }
        class MainModel extends Model {
            @Field() sub1: SubModel1;
        }
        const main = new MainModel({
            sub1: {
                sub2: { field: 'Test' },
            },
        });
        expect(main.sub1).to.be.an.instanceOf(SubModel1);
        expect(main.sub1.sub2).to.be.an.instanceOf(SubModel2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (main.sub1 as any).sub2 = 'invalid';
        expect(main.sub1.sub2).to.be.a('string');
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        (main.sub1 as any) = 'invalid';
        expect(main.sub1).to.be.a('string');
    });

    it('should prevent default values overwrite when initiated with data', () => {
        class TypePost extends Model {
            @Field() status = 'draft';
        }
        let post = new TypePost();
        expect(post.status).to.be.equal('draft');
        post.status = 'deleted';
        expect(post.status).to.be.equal('deleted');
        post = new TypePost({ status: 'published' });
        expect(post.status).to.be.equal('published');
        post = new TypePost({}, Storage.getFirestore().doc('a/1'));
        expect(post.status).to.be.undefined;
    });

    it('should set default values define in static schema on instantiation', () => {
        class VanillaPost extends Model {
            static schema = {
                status: {
                    type: String,
                    default: 'draft',
                },
            }
            status: string;
        }
        let post = new VanillaPost();
        expect(post.status).to.be.equal('draft');
        post = new VanillaPost({}, Storage.getFirestore().doc('a/1'));
        expect(post.status).to.be.undefined;
        post.status = 'deleted';
        expect(post.status).to.be.equal('deleted');
    });

    // -------------------------------------------------------------------------
    // Functional Tests
    // -------------------------------------------------------------------------

    it('should create a document with references and sub-collections', async function () {
        const data = {
            user: new User({ 'displayName': 'John' }),
            title: 'Model Integration Test',
            tags: ['tag1', 'tag2'],
            topics: [
                new Topic({ name: 'Test 1' }),
                { name: 'Test 2' },
            ],
            comments: [],
        };
        for (let i = 1; i <= 5; i++) {
            const comment = { content: 'comment ' + i, likes: [] };
            for (let j = 1; j <= 3; j++) {
                comment.likes.push({ user: 'user' + j });
            }
            data.comments.push(comment);
        }
        post = await Post.create(data, { callbacks: false, validate: false });
        expect(post.getId()).to.be.a('string');
        const result = await Post.doc(post.getId()).populate({
            user: ['id', 'displayName'],
            topics: ['id', 'name'],
            comments: ['likes'],
        }).get();
        expect(result).to.containSubset(post);
    });

    it('should update a document & related data', async function () {
        if (!post || !post.getId()) {
            this.skip();
        }
        post.user.displayName = 'Other';
        post.comments[0].content = 'Other';
        await post.save({ validate: false, callbacks: false });
        const result = await Post.doc(post.getId()).populate('user,comments').get();
        expect(post).to.containSubset(result);
    });

    it('should add remove and replace document in sub-collection', async function () {
        if (!post || !post.getId()) {
            this.skip();
        }
        // Remove a document. 
        post.comments.pop();
        // Add a new document.
        post.comments.push({ content: 'new doc 1' } as Comment);
        // Replace a document 
        post.comments[1] = { content: 'new doc 2' } as Comment;
        // Remove a doc not saved.
        post.comments.push({ content: 'new doc 3' } as Comment);
        post.comments.pop();
        await post.save({ validate: false, callbacks: false });
        const res = await Post.doc(post.getId()).populate({ comments: ['likes'] }).get();
        expect(res.comments).to.containSubset(post.comments);
    });

    it('should create a sub collection', async function () {
        if (!post || !post.getId()) {
            this.skip();
        }
        post.likes = [
            { user: User.ref('user-1') } as Like,
            { user: User.ref('user-2') } as Like,
        ];
        await post.save({ validate: false, callbacks: false });
        expect(post.likes).to.have.lengthOf(2);
        post.likes.should.each.be.an.instanceOf(Like);
        const result = await Post.doc(post.getId()).populate('likes').get();
        expect(result.likes).to.containSubset(post.likes);
    });

    it('should delete document with it\'s sub-collections recursively', async function () {
        // Extract all document paths.
        const extractPaths = (obj: Model, memo = []) => {
            memo.push(obj.getRef().path);
            Object.keys(obj).forEach(key => {
                if (obj[key] instanceof Collection) {
                    obj[key].forEach((obj: Model) => {
                        extractPaths(obj, memo);
                    });
                }
            });
            return memo;
        };
        const docPaths = extractPaths(post);
        // Use a batch in order to track the op paths.
        const batch = Firesnap.batch();
        await post.delete({ callbacks: false, session: batch });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opPaths = (batch as any)._ops.map((op: any) => op.docPath);
        expect(opPaths).to.have.members(docPaths);
    });

    it('should handle unique validation rule', async () => {
        // Note: Unique rule is not checked by the validator.
        const username = 'user' + Date.now();
        const user1 = new User({ username: username });
        const user2 = new User({ username: username });

        await user1.save();
        expect(user1.getId()).to.be.a('string');

        await assertRejects(user2.save());
        user2.username = user2.username + '_';
        await assertResolves(user2.save());

        user1.username = 'trigger-change';
        user1.username = username;
        await assertResolves(user1.save());

        Storage.setSchemaField(User, 'username', { type: 'String', unique: false });
        user2.username = user1.username;
        await assertResolves(user2.save());
    });

    it('should not save or delete if the before callback returns false', async () => {

        @Schema({ path: 'test_posts' })
        class TestPost extends Post {
            async beforeSave() {
                return false;
            }
            async beforeDelete() {
                return false;
            }
        }

        // Use a batch in order to track the operations.
        const batch = Firesnap.batch();
        const post = new TestPost({ title: 'Callbacks' });
        let success: boolean;

        // Save data.
        success = await post.save({ validate: false, session: batch });
        expect(success).to.be.false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((batch as any)._ops).to.be.empty;
        await post.save({ validate: false, callbacks: false });
        expect(post.getId()).to.be.a('string');

        // Delete data.
        success = await post.delete({ session: batch });
        expect(success).to.be.false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((batch as any)._ops).to.be.empty;
    });

    it('should create a document with a transaction', async () => {
        let check: Post = null;
        await Firesnap.transaction(async txn => {
            txnPost = await Post.create({ title: 'Transaction' }, {
                session: txn,
            });
            check = await Post.doc(txnPost.getId()).get();
            expect(check).to.be.null;
        });
        check = await Post.doc(txnPost.getId()).get();
        expect(check).to.be.an.instanceOf(Post);
    });

    it('should update a document with a transaction', async function () {
        let check: Post = null;
        if (!txnPost) {
            this.skip();
        }
        const oldVal = txnPost.title;
        const newVal = 'title-' + Date.now();
        await Firesnap.transaction(async txn => {
            txnPost.title = newVal;
            await txnPost.save({ session: txn });
            check = await Post.doc(txnPost.getId()).get();
            expect(check.title).to.be.equal(oldVal);
        });
        check = await Post.doc(txnPost.getId()).get();
        expect(check.title).to.be.equal(newVal);
    });

    it('should delete a document with a transaction', async function () {
        let check: Post = null;
        if (!txnPost) {
            this.skip();
        }
        const postId = txnPost.getId();
        await Firesnap.transaction(async txn => {
            await txnPost.delete({ session: txn });
            check = await Post.doc(txnPost.getId()).get();
            expect(check).to.be.an.instanceOf(Post);
        });
        expect(txnPost.getId()).to.be.null;
        check = await Post.doc(postId).get();
        expect(check).to.be.null;
    });

    it('should create a model instance with a specific id', async () => {
        const docId = 'custom-doc-id';
        const post = new Post();
        post.setId(docId);
        // Must be treated as a new document (title required).
        await assertRejects(post.save());
        post.title = 'Custom Doc Id';
        
        await post.save();
        const res = await Post.doc(docId).get();
        expect(res).to.deep.include(post);
    });

});