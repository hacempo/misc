const fs = require('fs');
const Aria2Client = require('./aria2-client');
const { connectBrowser, createPage, closePage, disconnectBrowser } = require('./browser');
const { extractVideoId, readDownloadSource } = require('./hanime');
const { parseDownloadQueue, readBatch, writeBatch, removeOriginalRows, appendLine } = require('./queue');
const { mergeDirectory, mapDirectory } = require('./file-manager');
const { DOWNLOAD_FILE, CURRENT_BATCH_FILE, BLOB_FILE, DOWNLOAD_SOURCE_ROOT, DOWNLOAD_TARGET_ROOT } = require('./config');


const MAX_BATCH_SIZE = 5;
const MAX_RETRIES = 5;
const POLL_INTERVAL = 3000;
const ADD_INTERVAL = 200;
const ARIA2_OPTIONS = {
    'max-tries': '5',
    'retry-wait': '5',
    'connect-timeout': '20',
    timeout: '60',
    continue: 'true',
    'auto-file-renaming': 'false'
};

let stopping = false;

class BlobDiscoveredError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BlobDiscoveredError';
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isHttp410(task) {
    return String(task.errorCode || '') === '22' &&
        /http\s*410/i.test(String(task.errorMessage || ''));
}

function groupByDirectory(items) {
    const groups = new Map();
    for (const item of items) {
        if (!groups.has(item.dir)) groups.set(item.dir, []);
        groups.get(item.dir).push(item);
    }
    return groups;
}

function buildNextBatch(items) {
    const groups = [...groupByDirectory(items).values()];
    const batch = [];

    for (const group of groups) {
        if (!batch.length || batch.length + group.length <= MAX_BATCH_SIZE) {
            batch.push(...group);
        } else {
            break;
        }
    }
    return batch;
}

function getBatchDirectories(batch) {
    return [...new Set(batch.map(item => item.dir))];
}

function restoreBatch(currentItems, queueItems) {
    const used = new Set();

    return currentItems.map(current => {
        const exactIndex = queueItems.findIndex((item, index) =>
            !used.has(index) && item.url === current.url && item.dir === current.dir
        );

        let index = exactIndex;
        if (index < 0) {
            const currentId = extractVideoId(current.url);
            index = queueItems.findIndex((item, itemIndex) =>
                !used.has(itemIndex) &&
                item.dir === current.dir &&
                currentId &&
                extractVideoId(item.url) === currentId
            );
        }

        if (index < 0) {
            throw new Error('无法从 download.txt 找回批次任务：' + current.url + '\t' + current.dir);
        }

        used.add(index);
        return { ...queueItems[index], url: current.url };
    });
}

function ensureCurrentBatch(batch) {
    writeBatch(CURRENT_BATCH_FILE, batch);
}

function saveBlob(url, dir) {
    appendLine(BLOB_FILE, url + '\t' + dir);
}

function checkStopping() {
    if (stopping) throw new Error('收到停止信号；current-batch.txt 已保留以便恢复。');
}

async function refreshHanimeUrl(oldUrl) {
    const id = extractVideoId(oldUrl);
    if (!id) throw new Error('无法从失败 URL 提取 Hanime 视频 ID：' + oldUrl);

    let browser;
    let page;
    try {
        browser = await connectBrowser();
        page = await createPage(browser, 30000);
        return await readDownloadSource(page, id, '.exoclick-popunder.juicyads-popunder');
    } finally {
        await closePage(page);
        disconnectBrowser(browser);
    }
}

async function waitForBatch(aria2, gids) {
    let missingRounds = 0;

    while (true) {
        checkStopping();
        const statuses = await aria2.getTasksByGids(gids);
        const failed = [];
        let completed = 0;
        let missing = 0;

        for (const gid of gids) {
            const task = statuses.get(gid);
            if (!task) {
                missing += 1;
            } else if (task.status === 'complete') {
                completed += 1;
            } else if (task.status === 'error' || task.status === 'removed') {
                failed.push({ gid, task });
            }
        }

        console.log(
            'Batch：完成 ' + completed + '/' + gids.length +
            '，失败 ' + failed.length + '，未找到状态 ' + missing
        );

        if (failed.length) return { completed: false, failed };
        if (completed === gids.length) return { completed: true, failed: [] };

        missingRounds = missing ? missingRounds + 1 : 0;
        if (missingRounds >= 10) {
            throw new Error('连续多次无法查询 aria2 任务状态；请检查 aria2，current-batch.txt 已保留。');
        }

        await sleep(POLL_INTERVAL);
    }
}

async function submitTask(aria2, item) {
    return aria2.addUri(item.url, item.dir, ARIA2_OPTIONS);
}

async function retryFailedTasks(aria2, batch, failed) {
    const newGids = [];

    for (const failure of failed) {
        checkStopping();

        const item = batch.find(entry => entry._gid === failure.gid);
        if (!item) throw new Error('找不到失败 GID 对应的队列项目：' + failure.gid);

        const task = failure.task;
        console.warn(
            '[FAILED] ' + failure.gid +
            ' code=' + (task.errorCode || '') +
            ' message=' + (task.errorMessage || '')
        );

        if (isHttp410(task)) {
            console.log('[HTTP 410] 通过 Puppeteer 刷新下载 URL');
            const newUrl = await refreshHanimeUrl(item.url);

            if (/^blob:/i.test(newUrl)) {
                saveBlob(newUrl, item.dir);
                removeOriginalRows(DOWNLOAD_FILE, [item]);
                batch.splice(batch.indexOf(item), 1);
                ensureCurrentBatch(batch);
                throw new BlobDiscoveredError(
                    '发现 blob URL，已保存到 blob-manual.txt；剩余任务保存在 current-batch.txt。'
                );
            }

            item.url = newUrl;
            ensureCurrentBatch(batch);
        }

        const newGid = await submitTask(aria2, item);
        item._gid = newGid;
        newGids.push(newGid);
        console.log('[RETRY] ' + newGid + ' ' + item.url);
        if (ADD_INTERVAL) await sleep(ADD_INTERVAL);
    }

    return newGids;
}

async function downloadBatch(aria2, batch) {
    if (!batch.length) return;

    ensureCurrentBatch(batch);
    const gids = [];

    for (const item of batch) {
        checkStopping();
        const gid = await submitTask(aria2, item);
        item._gid = gid;
        gids.push(gid);
        console.log('[ADD] ' + gid + ' ' + item.url);
        if (ADD_INTERVAL) await sleep(ADD_INTERVAL);
    }

    let activeGids = gids;
    let retryRound = 0;

    while (activeGids.length) {
        const result = await waitForBatch(aria2, activeGids);
        if (result.completed) break;

        retryRound += 1;
        if (retryRound > MAX_RETRIES) {
            const details = result.failed.map(({ gid, task }) =>
                'GID=' + gid + ' code=' + (task.errorCode || '') + ' ' + (task.errorMessage || '')
            ).join('\n');
            throw new Error('批次超过最大重试次数：\n' + details);
        }

        const failedGids = new Set(result.failed.map(item => item.gid));
        const newGids = await retryFailedTasks(aria2, batch, result.failed);
        activeGids = activeGids.filter(gid => !failedGids.has(gid)).concat(newGids);
    }

    checkStopping();
    for (const sourceDir of getBatchDirectories(batch)) {
        checkStopping();
        const targetDir = mapDirectory(sourceDir, DOWNLOAD_SOURCE_ROOT, DOWNLOAD_TARGET_ROOT);
        console.log('[MOVE] ' + sourceDir + ' -> ' + targetDir);
        mergeDirectory(sourceDir, targetDir);
    }

    removeOriginalRows(DOWNLOAD_FILE, batch);
    fs.writeFileSync(CURRENT_BATCH_FILE, '', 'utf8');
    console.log('[DONE] 当前批次完成');
}

function readQueueOrReport() {
    const { valid, invalid } = parseDownloadQueue(DOWNLOAD_FILE);
    for (const item of invalid) {
        console.warn('[INVALID] 第 ' + item.lineNumber + ' 行：' + item.reason + '：' + item.line);
    }
    return valid;
}

async function recoverInterruptedBatch(aria2) {
    const current = readBatch(CURRENT_BATCH_FILE);
    if (!current.length) return false;

    const queue = readQueueOrReport();
    const batch = restoreBatch(current, queue);
    console.log('[RECOVER] 恢复上次未完成的 ' + batch.length + ' 个任务');
    await downloadBatch(aria2, batch);
    return true;
}

async function handleBlobQueue() {
    const queue = readQueueOrReport();
    const blobs = queue.filter(item => /^blob:/i.test(item.url));
    if (!blobs.length) return false;

    for (const item of blobs) saveBlob(item.url, item.dir);
    removeOriginalRows(DOWNLOAD_FILE, blobs);
    console.warn('[BLOB] 已将 ' + blobs.length + ' 个 blob 任务转存到 blob-manual.txt');
    return true;
}

async function runBatchDownloader() {
    const aria2 = new Aria2Client();
    const version = await aria2.test();
    console.log('aria2 ' + version.version + ' 已连接');

    if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
        throw new Error('需要支持 fetch 和 AbortController 的 Node.js 版本。');
    }

    await recoverInterruptedBatch(aria2);

    while (true) {
        checkStopping();

        if (await handleBlobQueue()) continue;

        const items = readQueueOrReport();
        if (!items.length) {
            if (fs.existsSync(DOWNLOAD_FILE) &&
                fs.readFileSync(DOWNLOAD_FILE, 'utf8').trim()) {
                throw new Error('download.txt 中只剩无效记录；请修复异常行后再运行。');
            }
            console.log('download.txt 没有待下载任务。');
            return;
        }

        const batch = buildNextBatch(items);
        if (!batch.length) return;

        console.log('[BATCH] ' + batch.length + ' 个链接，' + getBatchDirectories(batch).length + ' 个目录');
        await downloadBatch(aria2, batch);
    }
}

process.once('SIGINT', () => {
    stopping = true;
    console.warn('\n收到 Ctrl+C，将在当前安全检查点停止；current-batch.txt 会保留。');
});

module.exports = { runBatchDownloader, buildNextBatch, restoreBatch };
