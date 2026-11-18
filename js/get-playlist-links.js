const { withPage } = require('./lib/browser');
const { readPlaylistLinks } = require('./lib/hanime-video');
const { readLines, writeLinesAtomic } = require('./lib/queue');
const { FILTERED_LINKS_FILE, PLAYLIST_LINKS_FILE } = require('./lib/config');

async function main() {
    const inputFile = process.argv[2] || FILTERED_LINKS_FILE;
    const outputFile = process.argv[3] || PLAYLIST_LINKS_FILE;
    const videos = readLines(inputFile);
    const links = new Set();
    let errors = 0;

    await withPage(async page => {
        for (const [index, url] of videos.entries()) {
            try {
                const children = await readPlaylistLinks(page, url);
                for (const link of children) links.add(link);
                console.log('[' + (index + 1) + '/' + videos.length + '] ' + children.length + ' 个列表链接');
            } catch (error) {
                errors++;
                console.error('[VIDEO ERROR] ' + url + ': ' + error.message);
            }
        }
    });

    const output = [...links];
    writeLinesAtomic(outputFile, output);
    console.log('播放列表采集完成：' + output.length + ' 个链接，错误 ' + errors + ' -> ' + outputFile);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
