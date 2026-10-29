(() => {
  const slider = document.querySelector('[data-banner-slider]');
  const track = document.querySelector('[data-banner-track]');
  const slides = track ? Array.from(track.children) : [];
  const dots = Array.from(document.querySelectorAll('[data-banner-dot]'));
  let bannerIndex = 0;
  let bannerTimer = null;
  const showBanner = (nextIndex) => {
    if (!track || !slides.length) return;
    bannerIndex = (nextIndex + slides.length) % slides.length;
    track.style.transform = `translate3d(-${bannerIndex * 100}%,0,0)`;
    dots.forEach((dot, index) => {
      dot.classList.toggle('is-active', index === bannerIndex);
      dot.setAttribute('aria-current', index === bannerIndex ? 'true' : 'false');
    });
  };
  const stopBanner = () => {
    if (bannerTimer) window.clearInterval(bannerTimer);
    bannerTimer = null;
  };
  const startBanner = () => {
    stopBanner();
    if (slides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bannerTimer = window.setInterval(() => showBanner(bannerIndex + 1), 4800);
    }
  };
  document.querySelector('[data-banner-prev]')?.addEventListener('click', () => { showBanner(bannerIndex - 1); startBanner(); });
  document.querySelector('[data-banner-next]')?.addEventListener('click', () => { showBanner(bannerIndex + 1); startBanner(); });
  dots.forEach((dot) => dot.addEventListener('click', () => { showBanner(Number(dot.dataset.bannerDot)); startBanner(); }));
  slider?.addEventListener('mouseenter', stopBanner);
  slider?.addEventListener('mouseleave', startBanner);
  slider?.addEventListener('focusin', stopBanner);
  slider?.addEventListener('focusout', startBanner);
  document.addEventListener('visibilitychange', () => document.hidden ? stopBanner() : startBanner());
  showBanner(0);
  startBanner();
})();
