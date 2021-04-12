import { BuiltInValidationRule } from '../types';

export const ValidationRules: { [x: string]: BuiltInValidationRule } = {
    min: {
        valType: 'Number',
        cstType: 'Number',
        validator: (value: number, constraint: number) => (value >= constraint),
        message: (field) => `The field '${field.name}' must be greater than ${field.constraint}`,
    },
    max: {
        valType: 'Number',
        cstType: 'Number',
        validator: (value: number, constraint: number) => (value <= constraint),
        message: (field) => `The field '${field.name}' must be less than ${field.constraint}`,
    },
    minlength: {
        valType: 'String',
        cstType: 'Number',
        validator: (value: string, constraint: number) => (value.length >= constraint),
        message: (field) => `The field '${field.name}' must be at least ${field.constraint} characters long`,
    },
    maxlength: {
        valType: 'String',
        cstType: 'Number',
        validator: (value: string, constraint: number) => (value.length <= constraint),
        message: (field) => `The field '${field.name}' must be less than ${field.constraint} characters long`,
    },
    email: {
        valType: 'String',
        cstType: 'Boolean',
        validator: (value: string, constraint: boolean) => {
            // eslint-disable-next-line no-useless-escape
            const exp = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
            return constraint === false ? true : exp.test(value);
        },
        message: (field) => `The email '${field.value}' is invalid`,
    },
    url: {
        valType: 'String',
        cstType: 'Boolean',
        validator: (value: string, constraint: boolean) => {
            // eslint-disable-next-line no-useless-escape
            const exp = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&/=]*)/;
            return constraint === false ? true : exp.test(value);
        },
        message: (field) => `The URL '${field.value}' is invalid`,
    },
};