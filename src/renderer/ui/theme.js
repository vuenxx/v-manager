const THEME_KEY = 'vmanager-theme';

export function initTheme() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const body = document.body;

    if (!themeToggleBtn || !themeIcon) return;

    // M-15: Restore saved theme on startup
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    body.setAttribute('data-theme', savedTheme);
    themeIcon.textContent = savedTheme === 'dark' ? '🌙' : '☀️';

    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = body.getAttribute('data-theme');
        
        if (currentTheme === 'dark') {
            body.setAttribute('data-theme', 'light');
            themeIcon.textContent = '☀️';
            // M-15: Persist theme choice
            localStorage.setItem(THEME_KEY, 'light');
        } else {
            body.setAttribute('data-theme', 'dark');
            themeIcon.textContent = '🌙';
            // M-15: Persist theme choice
            localStorage.setItem(THEME_KEY, 'dark');
        }
    });
}
