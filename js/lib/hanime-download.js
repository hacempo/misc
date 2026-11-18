const { BASE_URL, extractVideoId } = require('./hanime-search');

function toDownloadUrl(watchUrl) {
    const url = new URL(watchUrl, BASE_URL);
    if (url.hostname !== 'hanime1.me' || url.pathname !== '/watch') {
        throw new Error('输入必须是 Hanime /watch 视频页 URL');
    }

    const id = url.searchParams.get('v');
    if (!id || !/^\d+$/.test(id)) throw new Error('watch URL 缺少有效的视频 ID');
    return BASE_URL + '/download?v=' + encodeURIComponent(id);
}

function validateDownloadUrl(downloadUrl) {
    const url = new URL(downloadUrl, BASE_URL);
    if (url.hostname !== 'hanime1.me' || url.pathname !== '/download') {
        throw new Error('输入必须是 Hanime /download 下载页 URL');
    }

    const id = extractVideoId(url.href);
    if (!id) throw new Error('download URL 缺少有效的视频 ID');
    return { url: BASE_URL + '/download?v=' + encodeURIComponent(id), id };
}

async function readDownloadDetails(page, downloadUrl) {
    const { url, id } = validateDownloadUrl(downloadUrl);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const titles = document.querySelectorAll('h3');
        const source = document.querySelector('.exoclick-popunder[data-url]')?.getAttribute('data-url');
        return titles.length === 1 && Boolean(titles[0].innerText.trim()) && Boolean(source);
    }, { timeout: 120000 });

    const result = await page.evaluate(() => ({
        title: document.querySelector('h3').innerText.replace(/\s+/g, ' ').trim(),
        url: document.querySelector('.exoclick-popunder[data-url]').getAttribute('data-url')
    }));

    if (!result.title || !result.url) throw new Error('下载页缺少唯一 h3 标题或 data-url：' + id);
    return {
        title: result.title.replace(/[\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim(),
        url: new URL(result.url, BASE_URL).href,
        downloadPageUrl: url
    };
}

module.exports = { toDownloadUrl, validateDownloadUrl, readDownloadDetails };
