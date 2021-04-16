import { QueryDocumentSnapshot, DocumentReference, WriteBatch, Transaction, Timestamp, GeoPoint } from '@google-cloud/firestore';
import { Model } from './Model';
import { Collection } from './Collection';
import { Query } from './Query';
// -------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------
export type ValidationConstraint = number | boolean | [number | boolean, string]
export type ValidationRule = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validator: (value: any, constraint?: ValidationConstraint) => boolean,
    message?: ValidateMessageFunction | string,
}
export type ValidationResult = {
    valid: boolean,
    data: ModelData,
    errors: Record<string, string>,
}
export type ValidationOptions = {
    ownerField?: string,
    newDocument?: boolean,
    authValue?: string | boolean,
}
export type BuiltInValidationRule = {
    valType: 'Number' | 'String' | 'Boolean',
    cstType: 'Number' | 'String' | 'Boolean',
    validator: (value: string | number, constraint: ValidationConstraint) => boolean,
    message?: ValidateMessageFunction,
}
export type ValidateMessageFunction =
    (field?: { name: string, value: unknown, constraint?: number }) => string;
// -------------------------------------------------------------------------
// Schema
// -------------------------------------------------------------------------
export type DataTypeConstructor =
    StringConstructor | NumberConstructor | BooleanConstructor | ObjectConstructor |
    ArrayConstructor | DateConstructor | typeof GeoPoint | typeof Timestamp;

export type DataTypeString =
    'String' | 'Number' | 'Boolean' | 'Object' | 'Array' | 'Date' |
    'GeoPoint' | 'Timestamp' | 'Reference' | 'Collection' | 'SubModel';

export type DefaultFunction = () => unknown;

export type FieldOptions = {
    of?: DataTypeConstructor | ModelConstructor | Exclude<DataTypeString, 'Collection'> | SchemaData,
    enum?: Array<string | number>,
    null?: boolean,
    read?: 'owner' | 'admin',
    write?: 'admin',
    required?: boolean | [boolean, string],
    unique?: boolean | [boolean, string],
    min?: number | [number, string],
    max?: number | [number, string],
    minlength?: number | [number, string],
    maxlength?: number | [number, string],
    url?: boolean | [boolean, string],
    email?: boolean | [boolean, string],
    validate?: ValidationRule,
}
export type SchemaField = FieldOptions & {
    default?: string | number | boolean | DefaultFunction
    type?: DataTypeString | DataTypeConstructor,
    model?: Constructor| ModelConstructor,
}
export type SchemaData = {
    [x: string]: SchemaField,
}
// -------------------------------------------------------------------------
export type ModelConfig = {
    path: string,
    ownerField: string,
}
export type ModelConfigOrField<T> = string extends T ? ModelConfig : string;
export type SaveParams = SaveOptions & {
    recurring: boolean,
    parentRef: DocumentReference,
    fieldName: string,
}
export type DeleteParams = DeleteOptions & {
    recurring: boolean,
}
export type ModelData = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [x: string]: any,
}
// -------------------------------------------------------------------------
// Method options
// -------------------------------------------------------------------------
export type ConfigOptions = {
    primaryKeyName?: string,
    getOptions?: GetOptions
}
export type GetOptions = {
    populatePrimaryKey?: boolean,
    populateCreateTime?: string | false,
    populateUpdateTime?: string | false,
    returnAllFields?: boolean,
    returnAsJSON?: boolean,
    session?: WriteBatch | Transaction,
}
export type SaveOptions = {
    overwrite?: boolean,
    validate?: boolean,
    callbacks?: boolean | 'beforeSave' | 'afterSave',
    session?: WriteBatch | Transaction,
}
export type DeleteOptions = {
    callbacks?: boolean | 'beforeDelete' | 'afterDelete',
    session?: WriteBatch | Transaction,
}
// -------------------------------------------------------------------------
// Query
// -------------------------------------------------------------------------
type QueryNumOps = '$gt' | '$gte' | '$lt' | '$lte';
type QueryArrOps = '$in' | '$nin' | '$aca';
type QueryAllOps = QueryNumOps | QueryArrOps | '$eq' | '$ne' | '$ac';
export type QueryWhere = {
    [x: string]: string | number | boolean | Model | DocumentReference | {
        [P in QueryAllOps]?:
        P extends QueryNumOps ? number | Date | Timestamp | GeoPoint :
            P extends QueryArrOps ? string[] | number[] | Model[]:
                string | number | boolean | Date | Timestamp | Model | DocumentReference
    }
};
export type QueryPopulate = {
    [x: string]: Partial<QueryData>
}
export type QueryData = {
    fields: string[] | null,
    where: QueryWhere | null,
    limit: number | null,
    after: [number | string | boolean | null | Model, boolean],
    before: [number | string | boolean | null | Model, boolean],
    sort: { [x: string]: 'asc' | 'desc' } | null,
    populate: QueryPopulate,
    auth: string | boolean | null
}
export type PopulatedDocSnapshot = QueryDocumentSnapshot & {
    populated?: { [x: string]: QueryDocumentSnapshot[] },
}
// -------------------------------------------------------------------------
// Model & SubModel
// -------------------------------------------------------------------------
export type IModel = Model & ModelData;

export interface ModelConstructor<T = Model> {
    new(data?: ModelData, refOrSnap?: DocumentReference | QueryDocumentSnapshot): T;
    path: string;
    schema: SchemaData;
    config: ModelConfig;
    collection<T extends Model>(): Collection<T>;
    getSchema(): SchemaData;
    getConfig<T extends string | null>(field?: T): ModelConfigOrField<T>;
    find<T extends Model>(this: ModelConstructor<T>, conditions: QueryWhere): Query<T>;
    findOne<T extends Model>(this: ModelConstructor<T>, conditions: QueryWhere): Query<T, true>;
    create<T extends Model>(this: ModelConstructor<T>, data: ModelData, options: SaveOptions): Promise<T>;
    ref<T>(this: ModelConstructor<T>, id: string): T;
}
// eslint-disable-next-line @typescript-eslint/ban-types
export type Constructor = { new(): {} }
// -------------------------------------------------------------------------