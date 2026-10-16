/** Small dependency-free validator for the JSON Schema vocabulary our cue schema uses. */
export interface Schema {
  type?: string;
  const?: unknown;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  minLength?: number;
  pattern?: string;
}

export function validateSchema(value: unknown, schema: Schema, path = '$'): string[] {
  const errors: string[] = [];
  const object = typeof value === 'object' && value !== null && !Array.isArray(value);
  const type = schema.type;
  if (type && !({ object, array: Array.isArray(value), string: typeof value === 'string',
    number: typeof value === 'number' && Number.isFinite(value),
    integer: typeof value === 'number' && Number.isInteger(value) } as Record<string, boolean>)[type]) {
    return [`${path}: expected ${type}`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (object) {
    const fields = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in fields)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(fields)) {
      const child = schema.properties?.[key];
      if (child) errors.push(...validateSchema(item, child, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown property`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items!, `${path}[${i}]`)));
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: invalid format`);
  }
  return errors;
}
