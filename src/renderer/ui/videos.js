import { t } from '../i18n/i18n.js';

export function initVideos() {
    // Listen for tab activation to load the videos automatically
    document.addEventListener('tab-activated', (e) => {
        if (e.detail && e.detail.tabId === 'videos') {
            console.log('[Videos Debug] Tab activated, starting video load...');
            loadVideos();
        }
    });
}

async function loadVideos() {
    const container = document.getElementById('videos-container');
    const loading = document.getElementById('videos-loading');
    const error = document.getElementById('videos-error');

    if (!container || !loading || !error) {
        console.warn('[Videos Debug] Missing required DOM elements for videos view:', { container: !!container, loading: !!loading, error: !!error });
        return;
    }

    // Reset UI state
    container.innerHTML = '';
    loading.style.display = 'block';
    error.style.display = 'none';

    try {
        console.log('[Videos Debug] Requesting YouTube RSS feed from main process...');
        // Fetch feed XML via IPC
        const xmlText = await window.electronAPI.fetchYoutubeVideos();
        console.log(`[Videos Debug] RSS feed response received (${xmlText ? xmlText.length : 0} bytes)`);
        
        // Parse feed XML using DOMParser
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            console.error('[Videos Debug] XML Parse Error:', parserError.textContent);
            throw new Error(`XML parsing failed: ${parserError.textContent}`);
        }

        // Get all entries (videos)
        const entries = xmlDoc.getElementsByTagName('entry');
        console.log(`[Videos Debug] Parsed XML successfully. Found ${entries.length} video entries.`);
        
        if (entries.length === 0) {
            console.warn('[Videos Debug] 0 entries found in RSS feed. Raw snippet:', xmlText ? xmlText.substring(0, 300) : 'null');
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

            console.log(`[Videos Debug] Rendering video card: "${title}" (ID: ${videoId}, Link: ${link})`);

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
                console.log('[Videos Debug] Video card clicked, opening external link:', link);
                if (window.electronAPI && window.electronAPI.openExternalLink) {
                    window.electronAPI.openExternalLink(link);
                } else if (window.electronAPI && window.electronAPI.openExternal) {
                    window.electronAPI.openExternal(link);
                }
            });

            container.appendChild(card);
        }
        console.log('[Videos Debug] All video cards appended to UI container successfully.');
    } catch (err) {
        console.error('[Videos Debug] Error loading or rendering YouTube RSS feed:', err);
        loading.style.display = 'none';
        error.style.display = 'block';
    }
}
