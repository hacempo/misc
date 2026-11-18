const path = require('path');
const { withPage } = require('./lib/browser');
const { readDownloadDetails, validateDownloadUrl } = require('./lib/hanime-download');
const { readLines, writeLinesAtomic, removeLines } = require('./lib/queue');
const { DOWNLOAD_FILE, SEND_FILE, SENDING_FILE } = require('./lib/config');

async function main() {
    const inputFile = process.argv[2] || DOWNLOAD_FILE;
    const outputFile = process.argv[3] || SEND_FILE;
    if (path.resolve(inputFile) === path.resolve(outputFile)) {
        throw new Error('输入文件和输出文件不能相同。');
    }

    const downloadUrls = readLines(inputFile);
    if (!downloadUrls.length) {
        console.log('没有 download 页 URL：' + inputFile);
        return;
    }

    const sendRows = readLines(outputFile);
    const knownPages = new Set(sendRows.flatMap(line => {
        const fields = line.split('\t');
        return fields.length === 3 ? [fields[2]] : [];
    }));
    const inProgressPages = new Set(readLines(SENDING_FILE).flatMap(line => {
        const fields = line.split('\t');
        return fields.length === 4 ? [fields[3]] : [];
    }));
    const outputRows = sendRows.slice();
    const completedInputs = [];
    let errors = 0;

    await withPage(async page => {
        for (const [index, rawUrl] of downloadUrls.entries()) {
            try {
                const downloadPageUrl = validateDownloadUrl(rawUrl).url;
                if (knownPages.has(downloadPageUrl) || inProgressPages.has(downloadPageUrl)) {
                    completedInputs.push(rawUrl);
                    console.log('[' + (index + 1) + '/' + downloadUrls.length + '] [EXISTS] ' + downloadPageUrl);
                    continue;
                }

                const task = await readDownloadDetails(page, downloadPageUrl);
                outputRows.push([task.title, task.url, task.downloadPageUrl].join('\t'));
                knownPages.add(task.downloadPageUrl);
                completedInputs.push(rawUrl);
                console.log('[' + (index + 1) + '/' + downloadUrls.length + '] [OK] ' + task.title);
            } catch (error) {
                errors++;
                console.error('[DOWNLOAD PAGE ERROR] ' + rawUrl + ': ' + error.message);
            }
        }
    });

    if (outputRows.length !== sendRows.length) writeLinesAtomic(outputFile, outputRows);
    if (completedInputs.length) removeLines(inputFile, completedInputs);

    console.log('下载信息提取完成：新增 ' + (outputRows.length - sendRows.length) +
        ' 个任务，已处理 ' + completedInputs.length + '，失败 ' + errors);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
