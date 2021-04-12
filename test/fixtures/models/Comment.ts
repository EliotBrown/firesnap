import { Schema, Model, Field, Collection } from '../../../src';
import { User } from './User';
import { Like } from './Like';

@Schema()
export class Comment extends Model {
    
    // Auto populated field.
    id: string;

    @Field() 
    content: string;

    @Field() 
    user: User;
    
    @Field() 
    createdAt: Date;

    @Collection(Like) 
    likes: Like[];

}