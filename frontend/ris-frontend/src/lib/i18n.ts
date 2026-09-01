import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';

void i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: localStorage.getItem('ris-lang') ?? 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'lg', 'sw'],
    // Only load 'common' initially; other namespaces lazy-loaded on demand
    ns: ['common'],
    defaultNS: 'common',
    // Enable lazy loading: i18next loads namespaces when first referenced via useTranslation('invoices')
    partialBundledLanguages: true,
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
