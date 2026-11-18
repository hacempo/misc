const { extractVideoId, getWatchUrl } = require('./hanime-search');

async function readPlaylistLinks(page, watchUrl) {
    const id = extractVideoId(watchUrl);
    if (!id) throw new Error('无效的视频页链接：' + watchUrl);

    await page.goto(getWatchUrl(id), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#playlist-scroll', { timeout: 8000 }).catch(() => {});

    const hrefs = await page.$$eval('#playlist-scroll [data-href]', elements =>
        elements.map(element => element.dataset.href).filter(Boolean)
    ).catch(() => []);

    const ids = [...new Set(hrefs.map(extractVideoId).filter(Boolean))];
    return ids.map(getWatchUrl);
}

module.exports = { readPlaylistLinks };
