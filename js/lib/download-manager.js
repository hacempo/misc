const Aria2Client = require('./aria2-client');
const { readLines, writeLinesAtomic, appendLine, parseDownloadTasks, removeOriginalRows } = require('./queue');
const { ensureDirectory } = require('./file-manager');
const { DOWNLOAD_FILE, RUNNING_FILE, RETRY_FILE, DOWNLOAD_ROOT } = require('./config');

const MAX_TASKS = 5;
const POLL_INTERVAL = 3000;
const ARIA2_OPTIONS = {
    'max-tries': '5',
    'retry-wait': '5',
    'connect-timeout': '20',
    timeout: '60',
    continue: 'true',
    'auto-file-renaming': 'false'
};

let stopping = false;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readRunningTasks() {
    return readLines(RUNNING_FILE).flatMap(line => {
        const fields = line.split('\t');
        if (fields.length !== 4) return [];
        const [gid, title, url, watchUrl] = fields;
        return gid && title && url && watchUrl ? [{ gid, title, url, watchUrl, line }] : [];
    });
}

function saveRunningTasks(items) {
    writeLinesAtomic(RUNNING_FILE, items.map(item =>
        [item.gid, item.title.replace(/[\t\r\n]/g, ' '), item.url, item.watchUrl].join('\t')
    ));
}

function addRetryUrl(watchUrl) {
    const existing = new Set(readLines(RETRY_FILE));
    if (!existing.has(watchUrl)) appendLine(RETRY_FILE, watchUrl);
    console.warn('[RETRY LIST] ' + watchUrl);
}

function logInvalidRows(rows) {
    for (const row of rows) {
        console.warn('[INVALID] 第 ' + row.lineNumber + ' 行：' + row.reason + '：' + row.line);
    }
}

async function updateRunningTasks(aria2, running) {
    if (!running.length) return [];
    const statuses = await aria2.getTasksByGids(running.map(item => item.gid));
    const active = [];

    for (const item of running) {
        const task = statuses.get(item.gid);
        if (!task) {
            addRetryUrl(item.watchUrl);
            console.warn('[MISSING] aria2 中找不到任务 ' + item.gid + '，已转入 retry.txt');
        } else if (task.status === 'complete') {
            console.log('[DONE] ' + item.title);
        } else if (task.status === 'error' || task.status === 'removed') {
            console.error('[FAILED] ' + item.title + ' code=' + (task.errorCode || '') + ' ' + (task.errorMessage || ''));
            addRetryUrl(item.watchUrl);
        } else {
            active.push(item);
        }
    }
    saveRunningTasks(active);
    return active;
}

async function submitAvailableTasks(aria2, running) {
    const { valid, invalid } = parseDownloadTasks(DOWNLOAD_FILE);
    logInvalidRows(invalid);
    if (!valid.length) return { running, pending: 0, invalid: invalid.length };

    const counts = await aria2.getTaskCounts();
    const slots = Math.max(0, MAX_TASKS - counts.total);
    console.log('aria2 active=' + counts.active + ' waiting=' + counts.waiting +
        ' queue=' + valid.length + ' free=' + slots);

    for (const item of valid.slice(0, slots)) {
        if (stopping) break;
        const directory = ensureDirectory(item.title, DOWNLOAD_ROOT);
        const gid = await aria2.addUri(item.url, directory, ARIA2_OPTIONS);
        const runningItem = { gid, title: item.title, url: item.url, watchUrl: item.watchUrl };
        running.push(runningItem);
        saveRunningTasks(running);
        removeOriginalRows(DOWNLOAD_FILE, [item]);
        console.log('[ADD] ' + gid + ' ' + item.title + ' -> ' + directory);
    }

    return { running, pending: valid.length, invalid: invalid.length };
}

async function runDownloadManager() {
    const aria2 = new Aria2Client();
    const version = await aria2.test();
    console.log('aria2 ' + version.version + ' 已连接；并发上限 ' + MAX_TASKS);

    let running = readRunningTasks();
    if (running.length) console.log('[RESUME] 恢复跟踪 ' + running.length + ' 个 aria2 任务');

    while (true) {
        if (stopping) {
            console.warn('已停止提交新任务；未完成任务保存在 ' + RUNNING_FILE);
            return;
        }

        running = await updateRunningTasks(aria2, running);
        const result = await submitAvailableTasks(aria2, running);
        running = result.running;

        if (!result.pending && !running.length) {
            if (result.invalid) {
                throw new Error('download.txt 中只剩无效记录；已保留原文件，请修复后重试。');
            }
            console.log('下载队列已清空，所有已提交任务均已结束。');
            return;
        }

        await sleep(POLL_INTERVAL);
    }
}

process.once('SIGINT', () => {
    stopping = true;
    console.warn('\n收到 Ctrl+C，将保留运行状态和未提交队列。');
});

module.exports = { runDownloadManager };
