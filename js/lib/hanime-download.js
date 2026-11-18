const { BASE_URL, extractVideoId, getWatchUrl } = require('./hanime-search');

function getDownloadPageUrl(watchUrl) {
    const id = extractVideoId(watchUrl);
    if (!id) throw new Error('无法从视频页链接提取 ID：' + watchUrl);
    return BASE_URL + '/download?v=' + encodeURIComponent(id);
}

async function readDownloadTask(page, watchUrl) {
    const id = extractVideoId(watchUrl);
    if (!id) throw new Error('无效的视频页链接：' + watchUrl);

    await page.goto(getDownloadPageUrl(watchUrl), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const titles = document.querySelectorAll('h3');
        const link = document.querySelector('.exoclick-popunder')?.getAttribute('data-url');
        return titles.length === 1 && Boolean(titles[0].innerText.trim()) && Boolean(link);
    }, { timeout: 120000 });

    const result = await page.evaluate(() => ({
        title: document.querySelector('h3').innerText.replace(/\s+/g, ' ').trim(),
        url: document.querySelector('.exoclick-popunder').getAttribute('data-url')
    }));

    if (!result.title || !result.url) throw new Error('下载页缺少唯一标题或下载链接：' + id);
    return {
        title: result.title.replace(/[\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim(),
        url: new URL(result.url, BASE_URL).href,
        watchUrl: getWatchUrl(id)
    };
}

module.exports = { getDownloadPageUrl, readDownloadTask };
