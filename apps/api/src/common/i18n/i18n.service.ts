import { Injectable } from '@nestjs/common';
import * as en from './locales/en.json';
import * as ar from './locales/ar.json';

type TranslationValue = string | Record<string, unknown>;
type TranslationBundle = Record<string, TranslationValue>;

@Injectable()
export class I18nService {
  private readonly locales: Record<string, TranslationBundle> = { en, ar };

  translate(key: string, lang: string = 'en', params?: Record<string, string>): string {
    const bundle = this.locales[lang] || this.locales.en;
    const keys = key.split('.');
    let value: TranslationValue | undefined = bundle;

    for (const k of keys) {
      if (typeof value === 'object' && value !== null) {
        value = (value as Record<string, TranslationValue>)[k];
      } else {
        value = undefined;
        break;
      }
    }

    if (typeof value !== 'string') {
      return key;
    }

    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, p) => params[p] ?? `{${p}}`);
    }

    return value;
  }

  t(key: string, lang?: string, params?: Record<string, string>): string {
    return this.translate(key, lang, params);
  }

  getSupportedLanguages(): string[] {
    return Object.keys(this.locales);
  }

  isLanguageSupported(lang: string): boolean {
    return lang in this.locales;
  }
}
