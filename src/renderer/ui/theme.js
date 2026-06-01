export function initTheme() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const body = document.body;

    if (!themeToggleBtn || !themeIcon) return;

    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = body.getAttribute('data-theme');
        
        if (currentTheme === 'dark') {
            body.setAttribute('data-theme', 'light');
            themeIcon.textContent = '☀️';
        } else {
            body.setAttribute('data-theme', 'dark');
            themeIcon.textContent = '🌙';
        }
    });
}
