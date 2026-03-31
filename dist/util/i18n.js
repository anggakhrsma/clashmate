/**
 * Simplified i18n — English only, no i18next dependency.
 * Drop-in replacement for the original i18next-based i18n function.
 * Interpolates {{key}} placeholders with values from the args object.
 */
import locales from './locales.js';
function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, key) => {
        if (acc && typeof acc === 'object')
            return acc[key];
        return undefined;
    }, obj);
}
function interpolate(template, args) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => args[key] ?? `{{${key}}}`);
}
export function i18n(key, args) {
    const template = getNestedValue(locales, key);
    if (typeof template !== 'string')
        return key;
    const { lng: _lng, ...interpolateArgs } = args;
    return interpolate(template, interpolateArgs);
}
//# sourceMappingURL=i18n.js.map