import { Schema, Model, Field } from '../../../src';

@Schema({path: 'test_topics'})
export class Topic extends Model {
   
    // Auto populated field.
    id: string;

    @Field()
    name: string;

}