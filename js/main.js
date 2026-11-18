const { connectBrowser, createPage, closePage, disconnectBrowser } = require('./lib/browser');
const { extractVideoId, getWatchUrl, readVideoTitle, readVideoSource, readPlaylistIds } = require('./lib/hanime');
const { openVideoDatabase } = require('./lib/video-db');
const { appendDownloadTask } = require('./lib/queue');
const { ensureSeriesDirectory } = require('./lib/file-manager');
const { DOWNLOAD_FILE, VIDEO_DB_FILE, DOWNLOAD_SOURCE_ROOT } = require('./lib/config');

const BASE_URL = 'https://hanime1.me';
const PAGE_NUMBER = Math.max(1, Number.parseInt(process.argv[2] || '1', 10) || 1);

function getCategoryUrl(pageNumber) {
    const url = new URL('/search', BASE_URL);
    url.searchParams.set('genre', '泡面番');
    if (pageNumber > 1) url.searchParams.set('page', String(pageNumber));
    return url.href;
}

async function collectCategoryIds(page) {
    await page.goto(getCategoryUrl(PAGE_NUMBER), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.home-rows-videos-wrapper', { timeout: 30000 });

    const links = await page.$eval('.home-rows-videos-wrapper', wrapper =>
        Array.from(wrapper.children)
            .slice(1)
            .filter(element => element.tagName === 'A')
            .map(element => element.href)
    );
    return [...new Set(links.map(extractVideoId).filter(Boolean))];
}

async function processVideo(page, database, id) {
    await page.goto(getWatchUrl(id), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const title = document.querySelectorAll('.video-description-panel > div')[2]?.innerText?.trim();
        const player = document.querySelector('#player');
        const source = player?.src || player?.querySelector('source')?.src;
        return Boolean((title && source) || document.querySelector('#playlist-scroll'));
    }, { timeout: 20000 }).catch(() => {});

    const title = await readVideoTitle(page);
    const source = await readVideoSource(page);
    if (title && source) {
        const directory = ensureSeriesDirectory(title, DOWNLOAD_SOURCE_ROOT);
        appendDownloadTask(DOWNLOAD_FILE, source, directory);
        database.insert(id);
        console.log('[QUEUED] ' + id + ' ' + directory);
    } else {
        console.warn('[SKIP] ' + id + '：页面标题或视频源尚未就绪');
    }

    // 即使当前视频缺少可下载源，也继续扩展其播放列表。
    return readPlaylistIds(page);
}

async function main() {
    const database = openVideoDatabase(VIDEO_DB_FILE);
    let browser;
    let page;

    try {
        browser = await connectBrowser();
        page = await createPage(browser);
        console.log('采集页面：' + getCategoryUrl(PAGE_NUMBER));

        const initialIds = await collectCategoryIds(page);
        const queue = [];
        const queued = new Set();

        for (const id of initialIds) {
            if (!database.has(id) && !queued.has(id)) {
                queued.add(id);
                queue.push(id);
            }
        }

        console.log('初始队列：' + queue.length);
        while (queue.length) {
            const id = queue.shift();
            try {
                const playlistIds = await processVideo(page, database, id);
                for (const childId of playlistIds || []) {
                    if (!database.has(childId) && !queued.has(childId)) {
                        queued.add(childId);
                        queue.push(childId);
                    }
                }
            } catch (error) {
                console.error('[ERROR] ' + id + ': ' + error.message);
            }
        }

        console.log('采集完成；数据库共 ' + database.count() + ' 个 ID');
    } finally {
        await closePage(page);
        disconnectBrowser(browser);
        database.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
