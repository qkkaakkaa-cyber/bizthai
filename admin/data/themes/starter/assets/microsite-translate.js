(() => {
  const languageButtons = Array.from(document.querySelectorAll('[data-ms-lang]'));
  if (!languageButtons.length || window.__bizthaiMicrositeTranslate) return;

  window.__bizthaiMicrositeTranslate = true;
  let pendingLanguage = '';
  let translateScript = null;

  const currentLanguage = () => {
    const match = document.cookie.match(/(?:^|;)\s*googtrans=([^;]+)/);
    return match ? decodeURIComponent(match[1]).split('/').pop() : 'en';
  };

  const markLanguage = (language) => {
    languageButtons.forEach((button) => {
      const active = button.dataset.msLang === language;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  const fireChange = (select) => {
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const applyLanguage = (language, attempt = 0) => {
    const select = document.querySelector('select.goog-te-combo');
    if (!select) {
      pendingLanguage = language;
      loadGoogleTranslate();
      if (attempt < 20) window.setTimeout(() => applyLanguage(language, attempt + 1), 250);
      return;
    }
    select.value = language;
    fireChange(select);
    pendingLanguage = '';
    markLanguage(language);
  };

  window.googleTranslateElementInitMsite = () => {
    if (!document.getElementById('google_translate_element_msite')) {
      const mount = document.createElement('div');
      mount.id = 'google_translate_element_msite';
      document.body.appendChild(mount);
    }
    new google.translate.TranslateElement({
      pageLanguage: 'en',
      includedLanguages: 'en,th,zh-CN',
      autoDisplay: false
    }, 'google_translate_element_msite');
    if (pendingLanguage) window.setTimeout(() => applyLanguage(pendingLanguage), 250);
  };

  function loadGoogleTranslate() {
    if (translateScript || window.google?.translate?.TranslateElement) return;
    translateScript = document.createElement('script');
    translateScript.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInitMsite';
    translateScript.async = true;
    translateScript.referrerPolicy = 'strict-origin-when-cross-origin';
    translateScript.onerror = () => {
      translateScript = null;
      languageButtons.filter((button) => button.dataset.msLang !== 'en').forEach((button) => {
        button.title = 'Translation is temporarily unavailable';
      });
    };
    document.body.appendChild(translateScript);
  }

  languageButtons.forEach((button) => {
    button.addEventListener('pointerenter', loadGoogleTranslate, { once: true });
    button.addEventListener('focusin', loadGoogleTranslate, { once: true });
    button.addEventListener('click', () => applyLanguage(button.dataset.msLang));
  });

  const savedLanguage = currentLanguage();
  markLanguage(['th', 'zh-CN'].includes(savedLanguage) ? savedLanguage : 'en');
  if (savedLanguage !== 'en') {
    pendingLanguage = savedLanguage;
    loadGoogleTranslate();
  }
})();
