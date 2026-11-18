const { toDownloadUrl } = require('./lib/hanime-download');
const { readLines, writeLinesAtomic } = require('./lib/queue');
const { WATCH_FILE, DOWNLOAD_FILE } = require('./lib/config');

function main() {
    const inputFile = process.argv[2] || WATCH_FILE;
    const outputFile = process.argv[3] || DOWNLOAD_FILE;
    const source = readLines(inputFile);
    if (!source.length) return console.log('没有 watch URL：' + inputFile);
    const converted = new Set(readLines(outputFile));
    let invalid = 0;
    for (const watchUrl of source) {
        try { converted.add(toDownloadUrl(watchUrl)); }
        catch (error) { invalid++; console.warn('[INVALID] ' + watchUrl + ': ' + error.message); }
    }
    writeLinesAtomic(outputFile, [...converted]);
    console.log('watch -> download 转换完成：共 ' + converted.size + ' 个，跳过 ' + invalid + ' 个');
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
