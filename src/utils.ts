import { Transaction, WriteBatch } from '@google-cloud/firestore';
import { Model } from './Model';
import { GetOptions, ModelConstructor, SaveOptions } from './types';

export function isModelInstance(value: unknown): value is Model {
    return (value && Object.getPrototypeOf(value.constructor).name === 'Model');
}
export function isSubModelInstance(value: unknown): boolean {
    return (value && value.constructor[Symbol.for('primaryModel')] === false);
}

export function isModelConstructor(value: unknown): value is ModelConstructor {
    return (value && /(?<=extends).*(?=Model)/.test(value.toString()));
}

export function flattenObject(src: Record<string, unknown>, excludeArray: boolean, sep = '.', path = []): Record<string, unknown> {
    const obj = { ...src }; 
    return Object.keys(obj).reduce((memo, prop) => Object.assign({}, memo,
        (obj[prop].constructor && (obj[prop].constructor === Object || (!excludeArray && obj[prop].constructor === Array)))
            ? flattenObject(obj[prop] as Record<string, unknown>, excludeArray, sep, path.concat([prop]))
            : { [path.concat([prop]).join(sep)]: obj[prop] }
    ), {});
}

export function expandObject(obj: Record<string, unknown>, sep = '.'): Record<string, unknown> {
    const result = {};
    for (const key in obj) {
        const keys = key.split(sep);
        keys.reduce((memo, prop, index) => {
            return memo[prop] || (
                memo[prop] = isNaN(Number(keys[index + 1]))
                    ? (keys.length - 1 == index ? obj[key] : {})
                    : []
            );
        }, result);
    }
    return result;
}

export function constructorName(value: unknown): string {
    if (value === null || value === undefined) {
        return 'Undefined';
    }
    return value.constructor.name;
}

export function getSession(options: SaveOptions | GetOptions): WriteBatch | Transaction {
    if (options.session) {
        if (!['WriteBatch', 'Transaction'].includes(options.session.constructor.name)) {
            throw Error('Invalid session, Expecting Batch or Transaction');
        }
        return options.session;
    } else {
        return null;
    }
}