const { withPage } = require('./lib/browser');
const { buildKeywordSearchUrl, collectVideoLinks } = require('./lib/hanime-search');
const { readLines, writeLinesAtomic } = require('./lib/queue');
const { TASK_FILE, VIDEO_LINKS_FILE } = require('./lib/config');

async function main() {
    const keywords = readLines(TASK_FILE);
    if (!keywords.length) {
        console.log('task.txt 没有搜索关键词。');
        return;
    }

    const links = new Set();
    let errors = 0;
    await withPage(async page => {
        for (const [index, keyword] of keywords.entries()) {
            const url = buildKeywordSearchUrl(keyword);
            console.log('[' + (index + 1) + '/' + keywords.length + '] ' + keyword);
            try {
                for (const link of await collectVideoLinks(page, url)) links.add(link);
            } catch (error) {
                errors++;
                console.error('[SEARCH ERROR] ' + keyword + ': ' + error.message);
            }
        }
    });

    const output = [...links];
    writeLinesAtomic(VIDEO_LINKS_FILE, output);
    console.log('完成：' + output.length + ' 个视频页链接，错误 ' + errors + ' -> ' + VIDEO_LINKS_FILE);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
