const path = require('path');
const Aria2Client = require('./lib/aria2-client');
const { readLines } = require('./lib/queue');
const { sanitizeFolderName } = require('./lib/file-manager');

const { RESULT_FILE, DOWNLOAD_TARGET_ROOT } = require('./lib/config');
const DOWNLOAD_ROOT = path.join(DOWNLOAD_TARGET_ROOT, 'h');

async function main() {
    const aria2 = new Aria2Client({ timeout: 15000 });
    await aria2.test();

    const lines = readLines(RESULT_FILE);
    if (!lines.length) {
        console.log('result.txt 没有任务。');
        return;
    }

    for (const line of lines) {
        const match = line.match(/^(.*?)\s+(https?:\/\/\S+)\s*$/);
        if (!match) {
            console.warn('[INVALID] ' + line);
            continue;
        }

        const title = sanitizeFolderName(match[1].trim());
        const url = match[2];
        const dir = path.join(DOWNLOAD_ROOT, title);

        try {
            const gid = await aria2.addUri(url, dir, {
                'max-tries': '5',
                'retry-wait': '5',
                'connect-timeout': '20',
                timeout: '60',
                continue: 'true',
                'auto-file-renaming': 'false'
            });
            console.log('[OK] ' + title + ' ' + gid);
        } catch (error) {
            console.error('[FAILED] ' + title + ': ' + error.message);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
