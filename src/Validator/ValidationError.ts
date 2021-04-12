export class ValidationError extends Error {
    public fields: Record<string, string>;
    constructor(fields: Record<string, string>) {
        const field = Object.keys(fields)[0];
        const message = `Field '${field}': ${fields[field]}`;
        super(message);
        this.name = 'ValidationError';
        this.fields = fields;
    }
}
