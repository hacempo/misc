const { withPage } = require('./lib/browser');
const { collectVideoLinks } = require('./lib/hanime-search');
const { writeLinesAtomic } = require('./lib/queue');
const { VIDEO_LINKS_FILE } = require('./lib/config');

async function main() {
    const searchUrl = process.argv[2];
    const outputFile = process.argv[3] || VIDEO_LINKS_FILE;
    if (!searchUrl) {
        throw new Error('用法：node js/get-video-links.js "https://hanime1.me/search?..." [输出文件]');
    }

    const links = await withPage(page => collectVideoLinks(page, searchUrl));
    writeLinesAtomic(outputFile, links);
    console.log('搜索页采集完成：' + links.length + ' 个视频页链接 -> ' + outputFile);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
