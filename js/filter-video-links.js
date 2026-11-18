const { extractVideoId, getWatchUrl } = require('./lib/hanime-search');
const { openVideoDatabase } = require('./lib/video-db');
const { readLines, writeLinesAtomic } = require('./lib/queue');
const { VIDEO_LINKS_FILE, FILTERED_LINKS_FILE, VIDEO_DB_FILE } = require('./lib/config');

function main() {
    const inputFile = process.argv[2] || VIDEO_LINKS_FILE;
    const outputFile = process.argv[3] || FILTERED_LINKS_FILE;
    const database = openVideoDatabase(VIDEO_DB_FILE);
    const output = new Set();
    let existed = 0;
    let invalid = 0;

    try {
        for (const line of readLines(inputFile)) {
            const id = extractVideoId(line);
            if (!id) {
                invalid++;
                console.warn('[INVALID] ' + line);
                continue;
            }
            if (database.has(id)) {
                existed++;
                continue;
            }
            output.add(getWatchUrl(id));
        }
        const links = [...output];
        writeLinesAtomic(outputFile, links);
        console.log('过滤完成：保留 ' + links.length + '，数据库已存在 ' + existed + '，无效 ' + invalid + ' -> ' + outputFile);
    } finally {
        database.close();
    }
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
