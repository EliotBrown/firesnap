import { Schema, Model, Field, ValidationRule } from '../../../src';

const phoneRule: ValidationRule = {
    validator: (value) => /\d{3}-\d{3}-\d{4}/.test(value),
    message: field => `${field.value} is not a valid phone number!`,
};

class Address {
    @Field() country: string;
    @Field() zipcode: string;
}

@Schema({ path: 'test_users' })
export class User extends Model {

    // Auto populated field.
    id: string;

    @Field()
    displayName: string;

    @Field({ unique: true })
    username: string;

    @Field({ validate: phoneRule, read: 'owner' })
    phone: string;

    @Field()
    postCount: number;

    @Field({ min: 13, max: 100 })
    age: number;

    @Field()
    address: Address;

}