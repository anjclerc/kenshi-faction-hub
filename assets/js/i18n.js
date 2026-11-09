// Mini i18n : charge i18n/<lang>.json et remplit les éléments [data-i18n].
const I18N = {
  lang: 'fr',
  dict: {},

  async load(lang) {
    const res = await fetch(`i18n/${lang}.json`);
    this.dict = await res.json();
    this.lang = lang;
    document.documentElement.lang = lang;
    try { localStorage.setItem('lang', lang); } catch (e) { /* stockage indisponible */ }
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = this.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = this.t(el.dataset.i18nPlaceholder);
    });
  },

  t(key) {
    return this.dict[key] ?? key;
  },

  initial() {
    let saved = null;
    try { saved = localStorage.getItem('lang'); } catch (e) { /* ignore */ }
    const browser = (navigator.language || 'fr').slice(0, 2);
    return [saved, browser, 'fr'].find(l => ['fr', 'en', 'ru'].includes(l));
  }
};
