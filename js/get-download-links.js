const { withPage } = require('./lib/browser');
const { searchVideoIds, readDownloadSource } = require('./lib/hanime');
const { readLines, writeLinesAtomic, appendLine } = require('./lib/queue');
const { ensureDirectory } = require('./lib/file-manager');

const { TASK_FILE, DOWNLOAD_FILE, DOWNLOAD_SOURCE_ROOT } = require('./lib/config');

async function main() {
    const tasks = readLines(TASK_FILE);
    if (!tasks.length) {
        console.log('task.txt 没有搜索任务。');
        return;
    }

    writeLinesAtomic(DOWNLOAD_FILE, []);
    const seen = new Set();
    let saved = 0;
    let errors = 0;

    await withPage(async page => {
        for (const [index, keyword] of tasks.entries()) {
            console.log('\n[' + (index + 1) + '/' + tasks.length + '] ' + keyword);
            const directory = ensureDirectory(keyword, DOWNLOAD_SOURCE_ROOT);

            let ids;
            try {
                ids = await searchVideoIds(page, keyword);
            } catch (error) {
                errors++;
                console.error('[SEARCH ERROR] ' + error.message);
                continue;
            }

            for (const id of ids) {
                if (seen.has(id)) continue;
                seen.add(id);

                try {
                    const url = await readDownloadSource(page, id);
                    appendLine(DOWNLOAD_FILE, url + '\t' + directory);
                    saved++;
                    console.log('[OK] ' + id + ' ' + url);
                } catch (error) {
                    errors++;
                    console.error('[VIDEO ERROR] ' + id + ': ' + error.message);
                }
            }
        }
    });

    console.log('\n完成：搜索词 ' + tasks.length + '，下载链接 ' + saved + '，错误 ' + errors);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
