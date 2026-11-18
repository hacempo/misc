const { withPage } = require('./lib/browser');
const { readDownloadTask } = require('./lib/hanime-download');
const { readLines, appendLine, parseDownloadTasks } = require('./lib/queue');
const { FILTERED_LINKS_FILE, DOWNLOAD_FILE, RUNNING_FILE } = require('./lib/config');

function getExistingWatchUrls(outputFile) {
    const queued = new Set([
        ...parseDownloadTasks(DOWNLOAD_FILE).valid.map(item => item.watchUrl),
        ...parseDownloadTasks(outputFile).valid.map(item => item.watchUrl)
    ]);
    const running = readLines(RUNNING_FILE).flatMap(line => {
        const fields = line.split('\t');
        return fields.length === 4 ? [fields[3]] : [];
    });
    return new Set([...queued, ...running]);
}

async function main() {
    const inputFile = process.argv[2] || FILTERED_LINKS_FILE;
    const outputFile = process.argv[3] || DOWNLOAD_FILE;
    const watchUrls = readLines(inputFile);
    if (!watchUrls.length) {
        console.log('没有需要处理的视频页链接：' + inputFile);
        return;
    }

    const seen = getExistingWatchUrls(outputFile);
    let saved = 0;
    let skipped = 0;
    let errors = 0;

    await withPage(async page => {
        for (const [index, watchUrl] of watchUrls.entries()) {
            try {
                const task = await readDownloadTask(page, watchUrl);
                if (seen.has(task.watchUrl)) {
                    skipped++;
                    continue;
                }
                appendLine(outputFile, [task.title, task.url, task.watchUrl].join('\t'));
                seen.add(task.watchUrl);
                saved++;
                console.log('[' + (index + 1) + '/' + watchUrls.length + '] [OK] ' + task.title);
            } catch (error) {
                errors++;
                console.error('[FAILED] ' + watchUrl + ': ' + error.message);
            }
        }
    });

    console.log('下载链接提取完成：新增 ' + saved + '，重复 ' + skipped + '，失败 ' + errors + ' -> ' + outputFile);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
