import pino from 'pino';

export const acceptedLogLevels = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const;

export type LogLevel = (typeof acceptedLogLevels)[number];

export type LoggerValidationField = 'name' | 'level';

export interface LoggerValidationError {
  readonly field: LoggerValidationField;
  readonly message: string;
  readonly received: string;
  readonly acceptedValues?: readonly LogLevel[];
}

export type LoggerValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LoggerValidationError };

function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length === 0 ? '<empty string>' : value;
  }

  if (value === null) {
    return '<null>';
  }

  if (value === undefined) {
    return '<undefined>';
  }

  return `<${typeof value}>`;
}

export function isLogLevel(level: string): level is LogLevel {
  return acceptedLogLevels.some((acceptedLevel) => acceptedLevel === level);
}

export function validateLoggerName(name: unknown): LoggerValidationResult<string> {
  if (typeof name !== 'string') {
    return {
      ok: false,
      error: {
        field: 'name',
        message: 'Logger name must be a non-empty string',
        received: describeValue(name),
      },
    };
  }

  const trimmedName = name.trim();

  if (trimmedName.length === 0) {
    return {
      ok: false,
      error: {
        field: 'name',
        message: 'Logger name must be a non-empty string',
        received: describeValue(name),
      },
    };
  }

  return { ok: true, value: trimmedName };
}

export function validateLogLevel(level: unknown): LoggerValidationResult<LogLevel> {
  if (typeof level !== 'string') {
    return {
      ok: false,
      error: {
        field: 'level',
        message: 'Logger level must be one of: trace, debug, info, warn, error, fatal, silent',
        received: describeValue(level),
        acceptedValues: acceptedLogLevels,
      },
    };
  }

  const trimmedLevel = level.trim();

  if (!isLogLevel(trimmedLevel)) {
    return {
      ok: false,
      error: {
        field: 'level',
        message: 'Logger level must be one of: trace, debug, info, warn, error, fatal, silent',
        received: describeValue(level),
        acceptedValues: acceptedLogLevels,
      },
    };
  }

  return { ok: true, value: trimmedLevel };
}

export function formatLoggerValidationError(error: LoggerValidationError): string {
  const acceptedValues = error.acceptedValues?.length
    ? ` Accepted values: ${error.acceptedValues.join(', ')}.`
    : '';

  return `${error.message}. Field: ${error.field}. Received: ${error.received}.${acceptedValues}`;
}

function requireLoggerName(name: string): string {
  const result = validateLoggerName(name);

  if (!result.ok) {
    throw new Error(formatLoggerValidationError(result.error));
  }

  return result.value;
}

function requireLogLevel(level: string): LogLevel {
  const result = validateLogLevel(level);

  if (!result.ok) {
    throw new Error(formatLoggerValidationError(result.error));
  }

  return result.value;
}

export function createLogger(name: string, level = 'info') {
  return pino({
    level: requireLogLevel(level),
    name: requireLoggerName(name),
  });
}

export type Logger = ReturnType<typeof createLogger>;
