# ORM for Firestore
[![NPM](https://img.shields.io/npm/v/firesnap)](https://www.npmjs.com/package/firesnap)
[![Build Status](https://www.travis-ci.com/EliotBrown/firesnap.svg?branch=main)](https://www.travis-ci.com/EliotBrown/firesnap)
[![Codecov](https://img.shields.io/codecov/c/github/EliotBrown/firesnap)](https://codecov.io/gh/EliotBrown/firesnap)

Firesnap is an ORM/ODM for Firestore inspired by Mongoose. Key features include data validation, population of related data, save and delete callbacks. I'm still working on the documentation and the readme doesn't cover everything but if you have any questions feel free to ask [here](https://github.com/EliotBrown/firesnap/discussions). I'm also looking for collaborators to write a complete Wiki.   


## Installation

```javascript
npm install firesnap
```
tsconfig.json
```JSON
{
  "compilerOptions": {
    ...
    "target": "ES2017",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
     "strict": false,   
    ...
  }
}
```

## Usage

```javascript

import * as admin from 'firebase-admin';
import { Firesnap } from 'firesnap';

const serviceAccount = require('path/to/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

Firesnap.initialize(admin.firestore());
```

Vanilla JavaScript

```javascript
const admin = require('firebase-admin');
const { Firesnap } = require('firesnap');
// etc...
```

### Create Models

```typescript 
import { Model, Field, Collection} from 'firesnap';
import { User, Comment, Topic } from 'path/to/models';

class Post extends Model {

    @Field({ required: true })
    title: string;

    @Field()
    created = Date.now;

    @Field()
    user: User;

    @Field({ of: String })
    tags: string[];

    @Field({ of: Topic })
    topics: Topic[];

    @Collection(Comment)
    comments: Comment[];

}
```

Vanilla JavaScript 

```javascript
const { Model, Collection } require('firesnap');
const { User, Comment, Topic } require('path/to/models');

class Post extends Model {
    static schema = {
        title: {
            type: String,
            required: true,
        },
        created: {
            type: Date,
            default: Date.now,
        },
        user: {
            type: User, 
        },
        topics: {
            type: [Topic],
        },
        comments: {
            type: Collection,
            of: Comment,
        },
    }
}
```

## Add Data
```javascript

import { Post } from 'path/to/models';

const post = new Post({
    title: 'Post Title',
    content: 'Content of the post',
});
await post.save();

// or
await Post.create({
    title: 'Post Title',
    content: 'Content of the post',
});
```

## Read Data

```javascript
// Retrieve a document by Id.
const post = await Post.doc('doc-id').get();

// Retrieve multiple documents.
const posts = await Post.find({ status: 'draft' }).get();

// Retrieve a single document.
const post = await Post.findOne({ status: 'draft' }).get();
```

## Update Data

```javascript

// Update a document by Id.
await Post.doc('doc-id').update({
    title: 'New Title',
});
// or
const post = await Post.doc('doc-id').get();
post.title = 'New Title';
await post.save();

// Update a multiple documents.
await Post.find({ status: 'draft' }).update({
    title: 'New Title',
});

```

## Delete Data

```javascript

// Delete a document by Id.
await Post.doc('doc-id').delete();
// or
const post = await Post.doc('doc-id').get();
await post.delete();

// Delete multiple documents.
await Post.find({ status: 'draft' }).delete();

// Delete a field. 
Post.doc('doc-id').update({
    title: FieldValue.delete(),
});
// or 
const post = await Post.doc('doc-id').get();
delete post.title;
await post.save();

```

## Query Operators

- `$eq` Matches values that are equal to a specified value.
- `$gt` Matches values that are greater than a specified value.
- `$gte` Matches values that are greater than or equal to a specified value.
- `$in` Matches any of the values specified in an array.
- `$lt` Matches values that are less than a specified value.
- `$lte` Matches values that are less than or equal to a specified value.
- `$ne` Matches all values that are not equal to a specified value.
- `$nin` Matches none of the values specified in an array.
- `$ac` Matches arrays that contain a specific value.
- `$aca` Matches arrays that contain any of the values specified in an array.

```javascript

let posts: Post[];

posts = await Post.find({
    visibility: { $eq: 'public' },
    voteCount: { $gt: 10, $lt: 80 },
    status: { $in: ['draft', 'published'] },
}).get();

posts = await Post.find({
    voteCount: { $gte: 40, $lte: 50 },
    tags: { $aca: ['tag1', 'tag2'] },
}).get();

posts = await Post.find({
    status: { $ne: 'published' }
}).get();

posts = await Post.find({
    tags: { $ac: 'tag1' },
    status: { $nin: ['published', 'draft'] },
}).get();

```

## Paginate Results

```javascript

// Use a document to define the query cursor.
const last = await Post.doc('post-id').get();
const next = await Post.find().sort('createdAt').after(last).limit(5).get();

// Paginate a query
const first = await Post.find().sort('createdAt').limit(5).get();
const last = first[first.length - 1];
const next = await Post.find().sort('createdAt').after(last).limit(5).get();

```

## Validate Data

```javascript

class Post extends Model {
    @Field({ 
        minlength: 10,
        required: true,
    })
    title: string;
}

const post = new Post({
    title: 'Title',
});

const result = await post.validate();
console.log(result.valid); 
// false
console.log(result.errors);
// { title: "The field 'title' must be at least 10 characters long" }

//or 
try {
    const post = await Post.create({
        content: 'Post without title',
    });
} catch (e) {
    console.log(e.message);
    // "Field 'title': This field is required"
    if (e.name === 'ValidationError') {
        console.log(e.fields);
        // { title: "This field is required" }
    }
}
```
### Built-in Validators 

- `min`: number
- `max`: number
- `minlength`: number
- `maxlength`: number
- `email`: boolean
- `url`: boolean
- `unique`: boolean
- `enum`: [string|number] 


### Custom Validators 

```javascript
class User extends Model {
    @Field({ 
        // Custom message.
        required: [true, 'Phone number required'],
        // Custom rule.
        validate: {
            validator: value => /\d{3}-\d{3}-\d{4}/.test(value),
            message: field => `${field.value} is not a valid phone number`,
        }
    })
    phone: string;
}

const user = new User();

user.phone = '646-999-88';
let result = await user.validate();
console.log(result.errors);
// { phone: '646-999-88 is not a valid phone number' }

user.phone = '';
result = await user.validate();
console.log(result.errors);
// { phone: 'Phone number required' }
 ```

### Disabling Validation
```javascript

const post = await Post.create({
    title: 'New Post',
}, {
    validate: false,
});

// or 
const post = new Post({
    title: 'New Post',
});
await post.save({
    validate: false,
});

 ```

## Populate Data

```javascript
class User extends Model {
    @Field() displayName: string;
    @Field() email: string;
}

class Comment extends Model {
    @Field() user: User;
    @Field() date: Date;
    @Field() content: string;
}

class Post extends Model {
    @Field() title: string;
    @Field() content: string;
    @Field() user: User; // Reference
    @Collection(Comment) comments: Comment[]; // Sub-collection
}

let posts: Post[];

// Select the title only and populate all user fields. 
posts = await Post.find().select('title').populate('user').limit(1).get()
console.log(posts);

// Populate only the user displayName 
posts = await Post.find().populate({ user: ['displayName'] }).limit(1).get()

// Populate the last 10 comments with their user. 
posts = await Post.find({id: 'doc-id'}).populate({
    comments: {
        fields: ['content'],
        sort: { date: 'desc' },
        limit: 10,
        populate: 'user',
    }
}).limit(1).get();
```

## Manage Sub-collections
```javascript
class Comment extends Model {
    @Field() content: string;
}

class Post extends Model {
    @Field() title: string;
    @Collection(Comment) comments: Comment[];
}

// Add a sub-document. 
await Post.doc('doc-id').collection('comment').add({
    content: 'New comment',
});

// Update a sub-document.
await Post.doc('doc-id').collection('comment').doc('sub-id').update({
    content: 'Updated comment',
});

// Delete a sub-document.
await Post.doc('doc-id').collection('comment').doc('sub-id').delete();
```

### 

```javascript
// Using a model instance. 
const post = await Post.doc('doc-id').populate('comments').get();

// Add a sub-document. 
const comment = new Comment({ content: 'New comment' });
post.comments.push(comment);
await post.save();

// Update a sub-document.
post.comments[0].content = 'Updated comment';
await post.save();

// Delete a sub-document.
post.comments.pop();
await post.save();
```

## Model Callbacks

```javascript
class User extends Model {
    @Field() displayName: string;
    @Field() postCount: number;
}

class Post extends Model {

    @Field() title: string;
    @Field() user: User;
    @Field() slug: string;

    // Create a slug before saving.
    async beforeSave(): Promise<boolean> {
        if (typeof this.title === 'string') {
            this.slug = this.title.toLowerCase().trim().replace(/([^\w]+)/g, '-');
        }
        return true;
    }
    
    // Increment the user post count after saving.
    async afterSave(created: boolean): Promise<void> {
        if (created && this.user) {
            await User.doc(this.user.getId()).update({
                postCount: FieldValue.increment(1),
            });
        }
    }

    // Keep track of the user before deleting.
    async beforeDelete(): Promise<boolean> {
        if (!this.user) {
            const post = await Post.doc(this.getId()).get();
            this.user = post ? post.user : null;
        }
        return true;
    }

    // Decrement the user post count after saving.
    async afterDelete(): Promise<void> {
        if (this.user) {
            User.doc(this.user.getId()).update({
                postCount: FieldValue.increment(-1),
            });
        }
    }
}
```

## Run Transactions 
```javascript
await Firesnap.transaction(async txn => {

    // Retrieve a document.
    await Post.doc('post-id').get({ session: txn });

    // Create a document.
    await Post.create({ title: 'New Post' }, { session: txn });

    // Update a document. 
    await Post.doc('post-id').update({ title: 'New Title' }, { session: txn });

    // Delete a document.
    await Post.doc('post-id').delete({ session: txn });

});
```

## Create Batches
```javascript
  
const batch = Firesnap.batch();

// Create a document.
await Post.create({ title: 'New Post' }, { session: batch });

// Update a document. 
await Post.doc('post-id').update({ title: 'New Title' }, { session: batch });

// Delete a document.
await Post.doc('post-id').delete({ session: batch });

await batch.commit();

```







