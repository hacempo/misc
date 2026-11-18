const BASE_URL = 'https://hanime1.me';
const SEARCH_SUFFIX = '&type=&genre=%E8%A3%8F%E7%95%AA&sort=&date=&duration=';

function extractVideoId(href) {
    try {
        const url = new URL(href, BASE_URL);
        const queryId = url.searchParams.get('v');
        if (queryId && /^\d+$/.test(queryId)) return queryId;

        const fileMatch = url.pathname.match(/(?:^|\/)(\d+)-[^/]+\.mp4$/i);
        return fileMatch ? fileMatch[1] : null;
    } catch {
        return null;
    }
}

function getSearchUrl(keyword) {
    return BASE_URL + '/search?query=' + encodeURIComponent(keyword) + SEARCH_SUFFIX;
}

function getWatchUrl(id) {
    return BASE_URL + '/watch?v=' + encodeURIComponent(id);
}

function getDownloadPageUrl(id) {
    return BASE_URL + '/download?v=' + encodeURIComponent(id);
}

async function searchVideoIds(page, keyword) {
    await page.goto(getSearchUrl(keyword), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.home-rows-videos-wrapper', { timeout: 30000 });

    const hrefs = await page.$$eval('.home-rows-videos-wrapper a[href]', links =>
        links.map(link => link.href)
    );

    return [...new Set(hrefs.map(extractVideoId).filter(Boolean))];
}

async function readVideoTitle(page) {
    return page.$$eval('.video-description-panel > div', elements =>
        elements[2]?.innerText?.trim() || null
    ).catch(() => null);
}

async function readVideoSource(page) {
    return page.$eval('#player', player => {
        if (player.src) return player.src;

        const sources = [...player.querySelectorAll('source')]
            .map(element => ({
                src: element.src,
                quality: Number(element.getAttribute('size')) || 0
            }))
            .filter(item => item.src)
            .sort((a, b) => b.quality - a.quality);

        return sources[0]?.src || null;
    }).catch(() => null);
}

async function readPlaylistIds(page) {
    const hrefs = await page.$$eval('#playlist-scroll [data-href]', elements =>
        elements.map(element => element.dataset.href).filter(Boolean)
    ).catch(() => []);

    return [...new Set(hrefs.map(extractVideoId).filter(Boolean))];
}

async function readDownloadSource(page, id, selector = '.exoclick-popunder') {
    await page.goto(getDownloadPageUrl(id), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        css => Boolean(document.querySelector(css)?.getAttribute('data-url')),
        { timeout: 30000 },
        selector
    );

    const value = await page.$eval(selector, element => element.getAttribute('data-url'));
    if (!value) throw new Error('下载页没有提供 data-url：' + id);
    return value;
}

module.exports = {
    BASE_URL,
    extractVideoId,
    getSearchUrl,
    getWatchUrl,
    getDownloadPageUrl,
    searchVideoIds,
    readVideoTitle,
    readVideoSource,
    readPlaylistIds,
    readDownloadSource
};
