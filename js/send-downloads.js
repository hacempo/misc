const Aria2Client = require('./lib/aria2-client');
const { parseDownloadQueue, removeOriginalRows } = require('./lib/queue');
const { DOWNLOAD_FILE } = require('./lib/config');

const MAX_TASKS = 5;
const CHECK_INTERVAL = 10000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function logInvalidRows(rows) {
    for (const row of rows) {
        console.warn('[INVALID] 第 ' + row.lineNumber + ' 行：' + row.reason + '：' + row.line);
    }
}

async function main() {
    const aria2 = new Aria2Client({ timeout: 15000 });
    await aria2.test();
    console.log('aria2 已连接；并发上限：' + MAX_TASKS);

    while (true) {
        const { valid, invalid } = parseDownloadQueue(DOWNLOAD_FILE);
        logInvalidRows(invalid);

        if (!valid.length) {
            if (invalid.length) {
                throw new Error('download.txt 中只剩格式错误的记录；已保留原文件，请修复后重试。');
            }
            console.log('download.txt 已清空');
            return;
        }

        const status = await aria2.getTaskCounts();
        const freeSlots = MAX_TASKS - status.total;
        console.log('aria2 active=' + status.active +
            ' waiting=' + status.waiting +
            ' queue=' + valid.length);

        if (freeSlots <= 0) {
            await sleep(CHECK_INTERVAL);
            continue;
        }

        const submitted = [];
        for (const item of valid.slice(0, freeSlots)) {
            try {
                const gid = await aria2.addUri(item.url, item.dir);
                submitted.push(item);
                console.log('[OK] ' + gid + ' ' + item.url);
            } catch (error) {
                console.error('[ERROR] ' + item.url + ': ' + error.message);
                break;
            }
        }

        if (submitted.length) {
            removeOriginalRows(DOWNLOAD_FILE, submitted);
        } else {
            await sleep(CHECK_INTERVAL);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
