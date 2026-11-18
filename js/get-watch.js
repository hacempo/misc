const { withPage } = require('./lib/browser');
const { readPlaylistLinks } = require('./lib/hanime-video');
const { readLines, writeLinesAtomic } = require('./lib/queue');
const { WATCH_FILE } = require('./lib/config');

async function main() {
    const file = process.argv[2] || WATCH_FILE;
    const source = readLines(file);
    if (!source.length) return console.log('没有 watch URL：' + file);
    const expanded = new Set(source);
    let errors = 0;
    await withPage(async page => {
        for (const [index, url] of source.entries()) {
            try {
                const links = await readPlaylistLinks(page, url);
                for (const link of links) expanded.add(link);
                console.log('[' + (index + 1) + '/' + source.length + '] 播放列表链接 ' + links.length + ' 个');
            } catch (error) {
                errors++;
                console.error('[WATCH ERROR] ' + url + ': ' + error.message);
            }
        }
    });
    writeLinesAtomic(file, [...expanded]);
    console.log('视频列表展开完成：原始 ' + source.length + '，合并后 ' + expanded.size + '，错误 ' + errors);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
