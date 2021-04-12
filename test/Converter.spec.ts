import { expect } from './utility/chai-setup';
import { Converter } from '../src/Converter';
import { Model, Firesnap, Field, Schema, GetOptions, PopulatedDocSnapshot } from '../src';
import { initFirestore } from './fixtures/firestore';
import { Post } from './fixtures/models/Post';
import { Firestore } from '@google-cloud/firestore';
import { Topic, User } from './fixtures/models';

describe('Converter', () => {

    @Schema({ ownerField: 'id' })
    class ModelA extends Model {
        @Field() title: string;
        @Field({ read: 'owner' }) private: string;
    }

    @Schema({ ownerField: 'ownerB' })
    class ModelB extends Model {
        @Field() title: string;
        @Field() ownerB: ModelA;
        @Field({ read: 'owner' }) private: string;
    }

    @Schema({ ownerField: 'ownerC' })
    class ModelC extends Model {
        @Field() ownerC: string;
        @Field({ read: 'owner' }) private: string;
        @Field() nullVal: string;
    }

    class Timestamp {
        toDate() {
            return new Date();
        }
    }

    class DocumentReference {
        public id: string;
        constructor(id: string) {
            this.id = id;
        }
    }

    const fireData = {
        title: 'Post title',
        other: 'not defined in schema',
        private: 'restricted data',
        ownerB: new DocumentReference('owner-b'),
        ownerC: 'owner-c',
        nullVal: null,
    };

    const emptyDoc = {
        id: 'doc-id',
        data() {
            return null;
        },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fireDoc: any = {
        id: 'doc-id',
        createTime: new Timestamp(),
        updateTime: new Timestamp(),
        data() {
            return fireData;
        },
    };

    let firestore: Firestore;

    before(async () => {
        firestore = await initFirestore();
        Firesnap.initialize(firestore), {
            primaryKeyName: 'id',
        };
    });

    // -------------------------------------------------------------------------
    // Unit Tests
    // ------------------------------------------------------------------------- 

    it('should handle empty DocumentSnapshot', async () => {
        const res = Converter.fromFirestore(emptyDoc as PopulatedDocSnapshot, ModelB,
            { fields: null }
        );
        expect(res).to.be.null;
    });

    it('should filter out unselected fields', async () => {
        const res = Converter.fromFirestore(fireDoc, ModelB,
            { fields: ['title'] },
            { returnAllFields: true, returnAsJSON: true }
        );
        expect(res).to.be.eql({ title: fireData.title });
    });

    it('should filter out fields with auth rules', async () => {

        // Document reference.
        let res = Converter.fromFirestore(fireDoc, ModelB, { auth: 'owner-b' });
        expect(res).to.have.property('private');
        res = Converter.fromFirestore(fireDoc, ModelB, { auth: 'other' });
        expect(res).to.not.have.property('private');
        res = Converter.fromFirestore(fireDoc, ModelB, { auth: false });
        expect(res).to.not.have.property('private');

        // Field value. 
        res = Converter.fromFirestore(fireDoc, ModelC, { auth: 'owner-c' });
        expect(res).to.have.property('private');

        // Document name. 
        res = Converter.fromFirestore(fireDoc, ModelA, { auth: 'doc-id' } );
        expect(res).to.have.property('private');
    });

    it('should populate created & updated fields', async () => {

        const options: GetOptions = {
            populateCreateTime: 'createdAt',
            populateUpdateTime: 'updatedAt',
        };

        // No fields selected.
        let res = Converter.fromFirestore(fireDoc, ModelA, { fields: null }, options);
        expect(res).to.have.property('createdAt');
        expect(res).to.have.property('updatedAt');

        // Fields selected. 
        res = Converter.fromFirestore(fireDoc, ModelA, { fields: ['createdAt'] }, options);
        expect(res).to.have.property('createdAt');
        expect(res).to.not.have.property('updatedAt');

        res = Converter.fromFirestore(fireDoc, ModelA, { fields: ['updatedAt'] } , options);
        expect(res).to.have.property('updatedAt');
        expect(res).to.not.have.property('createdAt');

    });

    // -------------------------------------------------------------------------
    // Functional Tests
    // ------------------------------------------------------------------------- 

    it('should handle missing reference', async () => {
        let post: Post;
        const userId = 'doe-not-exist';
        await firestore.doc('test_posts/missing-refs').set({
            title: 'Missing Ref',
            user: firestore.doc('test_users/' + userId),
        });

        // JSON format with id field populated. 
        post = await Post.doc('missing-refs').populate('user').get({
            returnAsJSON: true,
            populatePrimaryKey: true,
        });
        expect(post.user).to.have.deep.include({ id: userId });
     
        // JSON format with id field not populated. 
        post = await Post.doc('missing-refs').populate('user').get({
            returnAsJSON: true,
            populatePrimaryKey: false,
        });
        expect(post.user).to.be.undefined;
  
        // Model format (strings get auto converted to model instance by the Model). 
        post = await Post.doc('missing-refs').populate('topics').get({
            returnAsJSON: false,
        });
        expect(post.user).to.be.an.instanceOf(User);
    });

    it('should handle array of reference with missing items & mismatch types', async () => {
        /**
         * Note: We don't convert or remove mismatch result data types. 
         * We include them as it in the response in JSON. Whereas Model 
         * instances automatically convert values based on the schema.
         */
        let post: Post;
        const topicId = 'doe-not-exist';
        await firestore.doc('test_posts/missing-refs').set({
            title: 'Mismatch types & missing items',
            topics: [
                firestore.doc('test_topics/' + topicId),
                'not-a-reference',
            ],
        });

        // JSON format with id field populated. 
        post = await Post.doc('missing-refs').populate('topics').get({
            returnAsJSON: true,
            populatePrimaryKey: true,
        });
        expect(post.topics).to.have.deep.members([{ id: topicId }, 'not-a-reference']);
     
        // JSON format with id field not populated. 
        post = await Post.doc('missing-refs').populate('topics').get({
            returnAsJSON: true,
            populatePrimaryKey: false,
        });
        expect(post.topics).to.have.deep.members(['not-a-reference']);
  
        // Model format (strings get auto converted to model instance by the Model). 
        post = await Post.doc('missing-refs').populate('topics').get({
            returnAsJSON: false,
        });
        expect(post.topics).to.be.an('array');
        post.topics.should.each.be.an.instanceOf(Topic);
    });

});
