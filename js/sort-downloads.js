const { parseDownloadQueue, writeLinesAtomic } = require('./lib/queue');

const { DOWNLOAD_FILE: FILE } = require('./lib/config');

function main() {
    const { valid, invalid } = parseDownloadQueue(FILE);
    if (!valid.length && !invalid.length) {
        console.log('download.txt 已空。');
        return;
    }

    const groups = new Map();
    for (const item of valid) {
        if (!groups.has(item.dir)) groups.set(item.dir, []);
        groups.get(item.dir).push(item.line);
    }

    const sorted = [...groups.entries()].sort((a, b) => a[1].length - b[1].length);
    const output = sorted.flatMap(([, lines]) => lines);
    output.push(...invalid.map(item => item.line));
    writeLinesAtomic(FILE, output);

    console.log('完成：' + groups.size + ' 个目录，' + valid.length +
        ' 个有效任务，' + invalid.length + ' 个异常行（已保留）。');
    for (const [directory, lines] of sorted) {
        console.log(lines.length + '\t' + directory);
    }
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
