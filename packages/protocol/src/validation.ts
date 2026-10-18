import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import formatsModule from "ajv-formats";

import {
  type EventEnvelope,
  EventEnvelopeSchema,
  type SchemaName,
  schemaCatalog,
} from "./schemas.js";

export interface ValidationResult {
  valid: boolean;
  errors: readonly string[];
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: true,
});
const addFormats = formatsModule as unknown as FormatsPlugin;
addFormats(ajv);

const validators = new Map<SchemaName, ValidateFunction>();

function formatError(error: ErrorObject): string {
  const location = error.instancePath.length > 0 ? error.instancePath : "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

export function validateContract(
  name: SchemaName,
  value: unknown,
): ValidationResult {
  const cachedValidator = validators.get(name);
  const validator = cachedValidator ?? ajv.compile(schemaCatalog[name]);
  if (cachedValidator === undefined) validators.set(name, validator);

  const valid = validator(value);
  return {
    valid,
    errors: valid ? [] : (validator.errors ?? []).map(formatError),
  };
}

const eventValidator = ajv.compile<EventEnvelope>(EventEnvelopeSchema);

export function assertEventEnvelope(
  value: unknown,
): asserts value is EventEnvelope {
  if (!eventValidator(value)) {
    const message = (eventValidator.errors ?? []).map(formatError).join("; ");
    throw new TypeError(`Invalid EventEnvelope: ${message}`);
  }
}
