import { assertRejects, expect, sinon } from './utility/chai-setup';
import { Firesnap, Model } from '../src';
import { Storage } from '../src/Metadata';
import { initFirestore } from './fixtures/firestore';
import { SinonSpy } from 'sinon';
import { Post } from './fixtures/models';
import { Firestore } from '@google-cloud/firestore';

describe('Firesnap', () => {

    let storageCb: SinonSpy;
    let firestore: Firestore;

    before(async () => {
        firestore = await initFirestore();
        Firesnap.initialize(firestore);
        storageCb = sinon.spy(Storage, 'clearCallbacks');
    });

    beforeEach(() => {
        storageCb.resetHistory();
    });

    // -------------------------------------------------------------------------
    // Unit Tests
    // ------------------------------------------------------------------------- 

    it('should not initialize without a Firestore instance', async () => {
        expect(() => Firesnap.initialize(true as never)).to.throw(Error);
    });

    // -------------------------------------------------------------------------
    // Integration Tests
    // ------------------------------------------------------------------------- 

    it('should handle error inside transactions', async () => {
        let error = null;
        try {
            await Firesnap.transaction(async () => {
                throw Error();
            });
        } catch (e) {
            error = e;
        }
        expect(error).to.be.an.instanceOf(Error);
        expect(storageCb.callCount).to.be.equal(1);
    });

    it('should handle batch error before commit', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const oldTimer = (Firesnap as any).callbackTimeout;
        const newTimer = 10;
        Firesnap.callbackTimeout = newTimer;
        const batch = Firesnap.batch();
        const opSpy = sinon.spy(batch, 'set');
        try {
            batch.set(null, {});
        } catch (e) {
            // Empty
        }
        await (new Promise(resolve => setTimeout(resolve, newTimer * 2)));
        Firesnap.callbackTimeout = oldTimer;
        opSpy.restore();
        expect(opSpy.calledBefore(storageCb),
            'Callback called before batch operation, increase timer.'
        ).to.be.true;
        expect(storageCb.callCount).to.be.equal(1);
    });

    it('should handle batch error after commit', async () => {
        const batch = Firesnap.batch();
        for (let i = 0; i < 501; i++) {
            batch.set(firestore.doc(`test_batch/doc-${i}`), {});
        }
        // This would throw an error too.
        // batch.update(firestore.doc('does-not/exist'), {test: 1});
        try {
            await batch.commit();
        } catch (e) {
            // Empty
        }
        expect(storageCb.callCount).to.be.equal(1);
    });

    // -------------------------------------------------------------------------
    // Functional Tests
    // ------------------------------------------------------------------------- 
    it('should execute transaction callbacks', async () => {
        const post = new Post({ title: 'test' });
        const delCb = sinon.spy(post, 'afterDelete');
        const saveCb = sinon.spy(post, 'afterSave');
        await Firesnap.transaction(async txn => {
            await post.save({ session: txn, validate: false });
            await post.delete({ session: txn });
            expect(saveCb.callCount).to.be.equal(0);
            expect(delCb.callCount).to.be.equal(0);
        });
        expect(saveCb.callCount).to.be.equal(1);
        expect(delCb.callCount).to.be.equal(1);
    });

    it('should execute batch callbacks', async () => {
        const batch = Firesnap.batch();
        const post = new Post({ title: 'test' });
        const delCb = sinon.spy(post, 'afterDelete');
        const saveCb = sinon.spy(post, 'afterSave');
        await post.save({ session: batch, validate: false });
        await post.delete({ session: batch });
        expect(saveCb.callCount).to.be.equal(0);
        expect(delCb.callCount).to.be.equal(0);
        await batch.commit();
        expect(saveCb.callCount).to.be.equal(1);
        expect(saveCb.calledWith(true)).to.be.true;
        expect(delCb.callCount).to.be.equal(1);
    });

    it('should catch batch model callback errors', async () => {
        class Test_Batch extends Model {
            async afterSave(): Promise<void> {
                await (new Promise(resolve => setTimeout(resolve, 10)));
                throw new Error('callback');
            }
        }
        const batch = Firesnap.batch();
        await Test_Batch.doc('cb-error').set({ 'a': 1 }, { session: batch, validate: false });
        await assertRejects(batch.commit(), { message: 'callback' });
    });

});