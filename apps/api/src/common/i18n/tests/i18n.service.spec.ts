import { I18nService } from '../i18n.service';
import * as en from '../locales/en.json';
import * as ar from '../locales/ar.json';

describe('I18nService', () => {
  let service: I18nService;

  beforeEach(() => {
    service = new I18nService();
  });

  it('translates a nested key in English by default', () => {
    expect(service.translate('common.success')).toBe(en.common.success);
    expect(service.translate('common.success')).not.toBe('common.success');
  });

  it('returns a different string for Arabic', () => {
    expect(service.translate('common.success', 'ar')).toBe(ar.common.success);
    expect(service.translate('common.success', 'ar')).not.toBe(
      service.translate('common.success', 'en'),
    );
  });

  it('falls back to English for an unsupported language', () => {
    expect(service.translate('common.success', 'zz')).toBe(en.common.success);
  });

  it('interpolates named parameters', () => {
    expect(service.translate('common.notFound', 'en', { resource: 'Order' })).toBe(
      'Order not found',
    );
    expect(service.translate('common.alreadyExists', 'en', { resource: 'Order' })).toBe(
      'Order already exists',
    );
  });

  it('leaves unmatched placeholders intact', () => {
    expect(service.translate('common.notFound', 'en', { other: 'Order' })).toBe(
      '{resource} not found',
    );
  });

  it('returns the raw string when no params are supplied', () => {
    expect(service.translate('common.notFound', 'en')).toBe(en.common.notFound);
  });

  it('returns the key itself when the translation is missing', () => {
    expect(service.translate('does.not.exist')).toBe('does.not.exist');
  });

  it('returns the key when a path runs past a leaf', () => {
    expect(service.translate('common.success.deeper')).toBe('common.success.deeper');
  });

  it('returns the key when a non-leaf namespace is requested', () => {
    expect(service.translate('common')).toBe('common');
  });

  it('exposes t() as an alias', () => {
    expect(service.t('common.success', 'ar')).toBe(service.translate('common.success', 'ar'));
    expect(service.t('common.notFound', 'en', { resource: 'Menu' })).toBe('Menu not found');
  });

  it('lists the supported languages', () => {
    expect(service.getSupportedLanguages().sort()).toEqual(['ar', 'en']);
  });

  it('reports language support', () => {
    expect(service.isLanguageSupported('en')).toBe(true);
    expect(service.isLanguageSupported('ar')).toBe(true);
    expect(service.isLanguageSupported('fr')).toBe(false);
  });

  it('translates keys from every namespace', () => {
    const bundle = en as unknown as Record<string, Record<string, string>>;
    const namespaces = Object.keys(bundle).filter(
      (key) => key !== 'default' && key !== '__esModule',
    );
    expect(namespaces.length).toBeGreaterThan(1);

    for (const namespace of namespaces) {
      const firstKey = Object.keys(bundle[namespace])[0];
      expect(service.translate(`${namespace}.${firstKey}`, 'en')).not.toBe(
        `${namespace}.${firstKey}`,
      );
    }
  });
});
