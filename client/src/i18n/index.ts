import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import frCA from "./locales/fr-CA.json";

export const LOCALE_TO_I18N_LANGUAGE: Record<string, string> = {
  EN: "en",
  ES: "es",
  FR_CA: "fr-CA",
};

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    "fr-CA": { translation: frCA },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
