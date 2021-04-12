import { Schema, Model, Field, FieldValue, Collection } from '../../../src';
import { Topic } from './Topic';
import { User } from './User';
import { Comment } from './Comment';
import { Like } from './Like';

@Schema({
    ownerField: 'user',
    path: 'test_posts',
})
export class Post extends Model {

    // Auto populated field.
    id: string;

    @Field({
        minlength: [5, 'Enter at least 5 characters'],
        required: [true, 'Please enter a title'],
    })
    title: string;

    @Field()
    createdAt = Date.now;

    @Field({ required: false })
    user: User;

    @Field({ of: String })
    tags: string[];

    @Field({ of: Topic })
    topics: Topic[];

    @Field()
    slug: string;

    @Field({ enum: ['draft', 'published'] })
    status: string

    @Field({ write: 'admin' })
    approved: boolean

    @Field({ read: 'owner' })
    notes: string
    
    @Collection(Comment)
    comments: Comment[];

    @Collection(Like)
    likes: Like[];


    async beforeSave(): Promise<boolean> {
        if (typeof this.title === 'string') {
            this.slug = this.title.toLowerCase().trim().replace(/([^\w]+)/g, '-');
        }
        return true;
    }

    async afterSave(created: boolean): Promise<void> {
        if (created && this.user && this.user.getId()) {
            await User.doc(this.user.getId()).update({
                postCount: FieldValue.increment(1),
            });
        }
    }

    async beforeDelete(): Promise<boolean> {
        if (!this.user && this.getId()) {
            const post = await Post.doc(this.getId()).get();
            this.user = post ? post.user : null;
        }
        return true;
    }

    async afterDelete(): Promise<void> {
        if (this.user && this.user.getId()) {
            User.doc(this.user.getId()).update({
                postCount: FieldValue.increment(-1),
            });
        }
    }

}