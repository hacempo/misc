const { extractVideoId, getWatchUrl } = require('./lib/hanime-search');
const { openVideoDatabase } = require('./lib/video-db');
const { readLines, writeLinesAtomic } = require('./lib/queue');
const { WATCH_FILE, VIDEO_DB_FILE } = require('./lib/config');

function main() {
    const file = process.argv[2] || WATCH_FILE;
    const source = readLines(file);
    if (!source.length) return console.log('没有 watch URL：' + file);
    const database = openVideoDatabase(VIDEO_DB_FILE);
    const kept = new Set();
    let known = 0;
    let invalid = 0;
    try {
        for (const line of source) {
            const id = extractVideoId(line);
            if (!id) { invalid++; console.warn('[INVALID] ' + line); continue; }
            if (database.has(id)) { known++; continue; }
            kept.add(getWatchUrl(id));
        }
        writeLinesAtomic(file, [...kept]);
        console.log('ID 过滤完成：保留 ' + kept.size + '，数据库已有 ' + known + '，无效 ' + invalid);
    } finally { database.close(); }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
