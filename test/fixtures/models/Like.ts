import { Schema, Model, Field } from '../../../src';
import { User } from './User';

@Schema()
export class Like extends Model {

    @Field()
    date: Date;

    @Field()
    user: User;

}