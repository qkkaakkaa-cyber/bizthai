/**
 * WooCMS Community Portal - Main JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Progressive Loading Simulation
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
        progressBar.style.width = '30%';
        setTimeout(() => {
            progressBar.style.width = '70%';
        }, 200);
        setTimeout(() => {
            progressBar.style.width = '100%';
            setTimeout(() => {
                progressBar.style.opacity = '0';
            }, 300);
        }, 500);
    }

    // 2. Dark Mode Toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeToggleMobileBtn = document.getElementById('theme-toggle-mobile');
    
    // Check local storage or system preference
    if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    const toggleTheme = () => {
        if (document.documentElement.classList.contains('dark')) {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('color-theme', 'light');
        } else {
            document.documentElement.classList.add('dark');
            localStorage.setItem('color-theme', 'dark');
        }
    };

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }
    if (themeToggleMobileBtn) {
        themeToggleMobileBtn.addEventListener('click', toggleTheme);
    }



    // 3. 顶部搜索面板
    const initSiteSearchPanel = () => {
        const openBtn = document.getElementById('site-search-open');
        const panel = document.getElementById('site-search-panel');
        if (!openBtn || !panel) return;

        const closeBtn = document.getElementById('site-search-close');
        const input = document.getElementById('site-search-input');

        const open = () => {
            panel.classList.remove('opacity-0', 'pointer-events-none');
            if (input) {
                setTimeout(() => input.focus(), 0);
            }
        };

        const close = () => {
            panel.classList.add('opacity-0', 'pointer-events-none');
        };

        openBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (panel.classList.contains('pointer-events-none')) {
                open();
                return;
            }
            close();
        });

        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }

        document.addEventListener('click', (event) => {
            if (panel.classList.contains('pointer-events-none')) {
                return;
            }
            if (panel.contains(event.target) || openBtn.contains(event.target)) {
                return;
            }
            close();
        });

        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                close();
            }
        });
    };

    // 4. Mobile 侧滑菜单（使用模板内结构）
    const initMobileDrawer = () => {
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const drawerPanel = document.getElementById('mobile-menu');
        const drawerOverlay = document.getElementById('mobile-menu-overlay');
        if (!mobileMenuBtn || !drawerPanel || !drawerOverlay) return;

        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        drawerPanel.querySelectorAll('a[href]').forEach((link) => {
            const href = (link.getAttribute('href') || '').trim();
            if (href === currentPage || (currentPage === '' && href === 'index.html')) {
                link.classList.add('text-primary-600', 'bg-primary-50', 'dark:text-primary-400', 'dark:bg-slate-800/70');
                link.classList.remove('text-slate-700');
            }
        });

        const openDrawer = () => {
            drawerOverlay.classList.remove('opacity-0', 'pointer-events-none');
            drawerPanel.classList.remove('translate-x-full');
            document.body.classList.add('overflow-hidden');
        };

        const closeDrawer = () => {
            drawerOverlay.classList.add('opacity-0', 'pointer-events-none');
            drawerPanel.classList.add('translate-x-full');
            document.body.classList.remove('overflow-hidden');
        };

        const closeBtn = drawerPanel.querySelector('#mobile-menu-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeDrawer);
        }
        drawerOverlay.addEventListener('click', closeDrawer);
        drawerPanel.querySelectorAll('a[href]').forEach((link) => {
            link.addEventListener('click', closeDrawer);
        });
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeDrawer();
            }
        });
        window.matchMedia('(min-width: 768px)').addEventListener('change', (event) => {
            if (event.matches) {
                closeDrawer();
            }
        });

        mobileMenuBtn.addEventListener('click', openDrawer);
    };

    // 5. 移动端固定底部导航栏
    const injectMobileBottomNav = () => {
        const footer = document.querySelector('footer');
        if (!footer || document.getElementById('mobile-bottom-nav')) {
            return;
        }

        footer.classList.add('hidden', 'md:block');

        const spacer = document.createElement('div');
        spacer.className = 'h-16 md:hidden';
        spacer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(spacer);

        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const normalizePage = (name) => (name === '' ? 'index.html' : name);

        const items = [
            { href: 'index.html', label: '首页', icon: 'fa-house' },
            { href: 'download.html', label: '下载', icon: 'fa-download' },
            { href: 'docs.html', label: '文档', icon: 'fa-book' },
            { href: 'forum.html', label: '社区', icon: 'fa-comments' },
            { href: 'profile.html', label: '我的', icon: 'fa-user' },
        ];

        const nav = document.createElement('nav');
        nav.id = 'mobile-bottom-nav';
        nav.className = 'fixed bottom-0 left-0 right-0 md:hidden bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 z-40 pb-[env(safe-area-inset-bottom)]';
        nav.setAttribute('aria-label', '底部导航');

        const container = document.createElement('div');
        container.className = 'grid grid-cols-5 h-16';

        items.forEach((item) => {
            const active = normalizePage(currentPage) === item.href;
            const link = document.createElement('a');
            link.href = item.href;
            link.className = `flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${active ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400'}`;
            link.innerHTML = `<i class="fa-solid ${item.icon} text-sm"></i><span>${item.label}</span>`;
            container.appendChild(link);
        });

        nav.appendChild(container);
        document.body.appendChild(nav);
    };

    // 6. Lazy Loading Images (Simple implementation)
    const lazyImages = document.querySelectorAll('img.lazyload');
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const image = entry.target;
                    // If we had data-src, we would swap it here
                    // image.src = image.dataset.src;
                    image.classList.remove('lazyload');
                    imageObserver.unobserve(image);
                }
            });
        });

        lazyImages.forEach(img => imageObserver.observe(img));
    }

    initSiteSearchPanel();
    initMobileDrawer();
    injectMobileBottomNav();
});
