const Aria2Client = require('./aria2-client');
const { readLines, writeLinesAtomic, appendLinesUnique, parseSendTasks } = require('./queue');
const { ensureDirectory } = require('./file-manager');
const { extractVideoId } = require('./hanime-search');
const { openVideoDatabase } = require('./video-db');
const { SEND_FILE, DOWNLOAD_FILE, SENDING_FILE, VIDEO_DB_FILE, DOWNLOAD_ROOT } = require('./config');

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

function readSendingTasks() {
    return readLines(SENDING_FILE).flatMap(line => {
        const fields = line.split('\t');
        if (fields.length !== 4) return [];
        const [gid, title, url, downloadPageUrl] = fields;
        return gid && title && url && downloadPageUrl ? [{ gid, title, url, downloadPageUrl }] : [];
    });
}

function saveSendingTasks(tasks) {
    writeLinesAtomic(SENDING_FILE, tasks.map(item =>
        [item.gid, item.title.replace(/[\t\r\n]/g, ' '), item.url, item.downloadPageUrl].join('\t')
    ));
}

function logInvalidRows(rows) {
    for (const row of rows) {
        console.warn('[INVALID] 第 ' + row.lineNumber + ' 行：' + row.reason + '：' + row.line);
    }
}

async function updateTaskStates(aria2, active, database) {
    if (!active.length) return { active, failures: [], changed: false };

    const states = await aria2.getTasksByGids(active.map(item => item.gid));
    const remaining = [];
    const failures = [];
    let changed = false;

    for (const item of active) {
        const state = states.get(item.gid);
        if (!state) {
            failures.push(item.downloadPageUrl);
            console.warn('[MISSING GID] ' + item.gid + '，download URL 回写到 download.txt');
            changed = true;
        } else if (state.status === 'complete') {
            const id = extractVideoId(item.downloadPageUrl);
            if (id) database.insert(id);
            console.log('[DONE] ' + item.title + (id ? ' [ID ' + id + ' 已入库]' : ''));
            changed = true;
        } else if (state.status === 'error' || state.status === 'removed') {
            failures.push(item.downloadPageUrl);
            console.error('[ARIA2 ERROR] ' + item.title + ' code=' +
                (state.errorCode || '') + ' ' + (state.errorMessage || ''));
            changed = true;
        } else {
            remaining.push(item);
        }
    }

    return { active: remaining, failures, changed };
}

function writeRemainingSendTasks(pending, invalid) {
    writeLinesAtomic(SEND_FILE, [...pending.map(item => item.line), ...invalid.map(item => item.line)]);
}

async function runAria2Downloader() {
    const parsed = parseSendTasks(SEND_FILE);
    logInvalidRows(parsed.invalid);
    let pending = parsed.valid.slice();
    let active = readSendingTasks();

    // 恢复 aria2 已接收但 send.txt 尚未删除的任务，避免重复提交。
    const activePages = new Set(active.map(item => item.downloadPageUrl));
    const duplicatePending = pending.filter(item => activePages.has(item.downloadPageUrl));
    if (duplicatePending.length) {
        const duplicateLines = new Set(duplicatePending.map(item => item.line));
        pending = pending.filter(item => !duplicateLines.has(item.line));
        writeRemainingSendTasks(pending, parsed.invalid);
    }

    if (!pending.length && !active.length) {
        if (parsed.invalid.length) {
            throw new Error('send.txt 中只剩格式错误的记录；原文件已保留，请修复后重试。');
        }
        console.log('send.txt 没有待下载任务。');
        return;
    }

    const aria2 = new Aria2Client();
    const version = await aria2.test();
    console.log('aria2 ' + version.version + ' 已连接；并发上限 ' + MAX_TASKS);

    const database = openVideoDatabase(VIDEO_DB_FILE);
    try {
        console.log('[QUEUE] 待提交 ' + pending.length + '，恢复跟踪 ' + active.length);

        while (pending.length || active.length) {
            if (stopping) {
                console.warn('收到 Ctrl+C；剩余任务保存在 send.txt 和 sending.txt。');
                return;
            }

            const updated = await updateTaskStates(aria2, active, database);
            active = updated.active;
            // Persist retry URLs first: a crash must not drop a failed task.
            if (updated.failures.length) appendLinesUnique(DOWNLOAD_FILE, updated.failures);
            if (updated.changed) saveSendingTasks(active);

            if (pending.length && !stopping) {
                const counts = await aria2.getTaskCounts();
                const slots = Math.max(0, MAX_TASKS - counts.total);
                console.log('aria2 active=' + counts.active + ' waiting=' + counts.waiting +
                    ' pending=' + pending.length + ' free=' + slots);

                const batch = pending.slice(0, slots);
                for (const item of batch) {
                    if (stopping) break;

                    if (/^blob:/i.test(item.url)) {
                        appendLinesUnique(DOWNLOAD_FILE, [item.downloadPageUrl]);
                        pending = pending.filter(entry => entry !== item);
                        writeRemainingSendTasks(pending, parsed.invalid);
                        continue;
                    }

                    const directory = ensureDirectory(item.title, DOWNLOAD_ROOT);
                    const gid = await aria2.addUri(item.url, directory, ARIA2_OPTIONS);
                    active.push({
                        gid,
                        title: item.title,
                        url: item.url,
                        downloadPageUrl: item.downloadPageUrl
                    });
                    saveSendingTasks(active);

                    pending = pending.filter(entry => entry !== item);
                    writeRemainingSendTasks(pending, parsed.invalid);
                    console.log('[ADD] ' + gid + ' ' + item.title + ' -> ' + directory);
                }
            }

            if (!pending.length && !active.length) break;
            await sleep(POLL_INTERVAL);
        }

        if (parsed.invalid.length) {
            throw new Error('send.txt 中仍有格式错误的记录；这些行已保留，请修复后重试。');
        }
        console.log('所有 aria2 任务已完成；失败 download 页 URL 已写入 ' + DOWNLOAD_FILE);
    } finally {
        database.close();
    }
}

process.once('SIGINT', () => {
    stopping = true;
    console.warn('\n收到停止信号，将保留当前任务状态。');
});

module.exports = { runAria2Downloader };
