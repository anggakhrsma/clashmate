/**
 * Simplified i18n — English only, no i18next dependency.
 * Drop-in replacement for the original i18next-based i18n function.
 * Interpolates {{key}} placeholders with values from the args object.
 */
import locales from './locales.js';

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never;

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...0[]];

type Leaves<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
    ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T]
    : '';

type Keys<S> = S extends `${string}{{${infer B}}}${infer C}`
  ? C extends `${string}{{${string}}}${string}`
    ? [B, ...Keys<C>]
    : [B]
  : never;

type GetDictValue<T extends string, O> = T extends `${infer A}.${infer B}`
  ? A extends keyof O
    ? GetDictValue<B, O[A]>
    : never
  : T extends keyof O
    ? O[T]
    : never;

type CheckDictString<T extends string, O> = T extends `${infer A}.${infer B}`
  ? A extends keyof O
    ? `${A}.${Extract<CheckDictString<B, O[A]>, string>}`
    : never
  : T extends keyof O
    ? T
    : never;

type Interpolate<S, I extends Record<Keys<S>[number], string>> = S extends ''
  ? ''
  : S extends `${infer A}{{${infer B}}}${infer C}`
    ? C extends `${string}{{${string}}}${string}`
      ? `${A}${I[Extract<B, keyof I>]}${Interpolate<C, I>}`
      : `${A}${I[Extract<B, keyof I>]}${C}`
    : S;

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj) as string;
}

function interpolate(template: string, args: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => args[key] ?? `{{${key}}}`);
}

export function i18n<
  K extends Leaves<typeof locales>,
  I extends Record<Keys<GetDictValue<K, typeof locales>>[number], string>
>(key: CheckDictString<K, typeof locales>, args: I & { lng?: string }): string {
  const template = getNestedValue(locales as unknown as Record<string, unknown>, key as string);
  if (typeof template !== 'string') return key as string;
  const { lng: _lng, ...interpolateArgs } = args;
  return interpolate(template, interpolateArgs as Record<string, string>);
}

export type TranslationKey = CheckDictString<Leaves<typeof locales>, typeof locales>;
