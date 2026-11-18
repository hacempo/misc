const { withPage } = require('./lib/browser');
const { collectVideoLinks } = require('./lib/hanime-search');
const { readLines, writeLinesAtomic } = require('./lib/queue');
const { SEARCH_FILE, WATCH_FILE } = require('./lib/config');

async function main() {
    const inputFile = process.argv[2] || SEARCH_FILE;
    const outputFile = process.argv[3] || WATCH_FILE;
    const searchUrls = readLines(inputFile);
    const links = new Set();
    let errors = 0;
    if (!searchUrls.length) {
        console.log('没有搜索页 URL：' + inputFile);
        return;
    }
    await withPage(async page => {
        for (const [index, url] of searchUrls.entries()) {
            try {
                const results = await collectVideoLinks(page, url);
                for (const link of results) links.add(link);
                console.log('[' + (index + 1) + '/' + searchUrls.length + '] ' + results.length + ' 个视频链接');
            } catch (error) {
                errors++;
                console.error('[SEARCH ERROR] ' + url + ': ' + error.message);
            }
        }
    });
    writeLinesAtomic(outputFile, [...links]);
    console.log('搜索采集完成：' + links.size + ' 个 watch 链接，错误 ' + errors);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
