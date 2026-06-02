import { t } from '../i18n/i18n.js';

export function initVideos() {
    // Listen for tab activation to load the videos automatically
    document.addEventListener('tab-activated', (e) => {
        if (e.detail && e.detail.tabId === 'videos') {
            loadVideos();
        }
    });
}

async function loadVideos() {
    const container = document.getElementById('videos-container');
    const loading = document.getElementById('videos-loading');
    const error = document.getElementById('videos-error');

    if (!container || !loading || !error) return;

    // Reset UI state
    container.innerHTML = '';
    loading.style.display = 'block';
    error.style.display = 'none';

    try {
        // Fetch feed XML via IPC
        const xmlText = await window.electronAPI.fetchYoutubeVideos();
        
        // Parse feed XML using DOMParser
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Get all entries (videos)
        const entries = xmlDoc.getElementsByTagName('entry');
        
        if (entries.length === 0) {
            throw new Error('No entries found in RSS feed');
        }

        loading.style.display = 'none';

        for (let entry of entries) {
            const title = entry.getElementsByTagName('title')[0]?.textContent || t('videos.untitled');
            
            // Extract YouTube Video ID
            const videoId = entry.getElementsByTagName('yt:videoId')[0]?.textContent || 
                            entry.getElementsByTagName('videoId')[0]?.textContent || '';
            
            // Get URL (try alternate link or build it)
            let link = '';
            const links = entry.getElementsByTagName('link');
            for (let l of links) {
                if (l.getAttribute('rel') === 'alternate') {
                    link = l.getAttribute('href');
                    break;
                }
            }
            if (!link && videoId) {
                link = `https://www.youtube.com/watch?v=${videoId}`;
            }

            // Create Video Card Element
            const card = document.createElement('div');
            card.className = 'video-card';
            
            // Thumbnail resolution optimization fallback: Try maxresdefault first, fall back to hqdefault on error
            const maxresUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
            const hqUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

            card.innerHTML = `
                <div class="video-thumbnail-wrapper">
                    <img class="video-thumbnail" src="${maxresUrl}" alt="${title}" onerror="this.onerror=null; this.src='${hqUrl}';">
                </div>
                <div class="video-info">
                    <h3 class="video-title">${title}</h3>
                </div>
            `;

            // Open URL in default system browser securely via IPC preload bridge
            card.addEventListener('click', () => {
                if (window.electronAPI && window.electronAPI.openExternalLink) {
                    window.electronAPI.openExternalLink(link);
                } else if (window.electronAPI && window.electronAPI.openExternal) {
                    window.electronAPI.openExternal(link);
                }
            });

            container.appendChild(card);
        }
    } catch (err) {
        console.error('Error rendering YouTube RSS feed:', err);
        loading.style.display = 'none';
        error.style.display = 'block';
    }
}
