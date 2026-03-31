import 'moment';
declare module 'moment' {
  interface Duration {
    format(template: string, options?: { trim?: string | boolean }): string;
  }
}
