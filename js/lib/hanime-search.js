const BASE_URL = 'https://hanime1.me';

function extractVideoId(href) {
    try {
        const url = new URL(href, BASE_URL);
        if (url.hostname !== 'hanime1.me') return null;
        const queryId = url.searchParams.get('v');
        if (queryId && /^\d+$/.test(queryId)) return queryId;
        const fileMatch = url.pathname.match(/(?:^|\/)(\d+)-[^/]+\.mp4$/i);
        return fileMatch ? fileMatch[1] : null;
    } catch {
        return null;
    }
}

function getWatchUrl(id) {
    return BASE_URL + '/watch?v=' + encodeURIComponent(id);
}

function validateSearchUrl(value) {
    const url = new URL(value, BASE_URL);
    if (url.origin !== BASE_URL || url.pathname !== '/search') {
        throw new Error('输入必须是 hanime1.me/search 搜索页 URL。');
    }
    return url.href;
}

function buildKeywordSearchUrl(keyword) {
    const url = new URL('/search', BASE_URL);
    url.searchParams.set('query', keyword);
    url.searchParams.set('type', '');
    url.searchParams.set('genre', '裏番');
    url.searchParams.set('sort', '');
    url.searchParams.set('date', '');
    url.searchParams.set('duration', '');
    return url.href;
}

async function collectVideoLinks(page, searchUrl) {
    const target = validateSearchUrl(searchUrl);
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.home-rows-videos-wrapper', { timeout: 30000 });

    const hrefs = await page.$$eval('.home-rows-videos-wrapper a[href]', anchors =>
        anchors.map(anchor => anchor.href)
    );
    const ids = [...new Set(hrefs.map(extractVideoId).filter(Boolean))];
    return ids.map(getWatchUrl);
}

module.exports = { BASE_URL, extractVideoId, getWatchUrl, validateSearchUrl, buildKeywordSearchUrl, collectVideoLinks };
