const fs = require('fs');
const path = require('path');
const { openVideoDatabase } = require('./lib/video-db');

const { VIDEO_LIBRARY_ROOT: VIDEO_ROOT, VIDEO_DB_FILE: DB_FILE } = require('./lib/config');
const BATCH_SIZE = 1000;

function main() {
    if (!fs.existsSync(VIDEO_ROOT) || !fs.statSync(VIDEO_ROOT).isDirectory()) {
        throw new Error('视频目录不存在或不是目录：' + VIDEO_ROOT);
    }

    const database = openVideoDatabase(DB_FILE);
    const pending = [];
    const stack = [VIDEO_ROOT];
    let fileCount = 0;
    let validCount = 0;
    let unreadableCount = 0;
    let newCount = 0;

    try {
        while (stack.length) {
            const directory = stack.pop();
            let entries;

            try {
                entries = fs.readdirSync(directory, { withFileTypes: true });
            } catch (error) {
                unreadableCount++;
                console.warn('[READ ERROR] ' + directory + ': ' + error.message);
                continue;
            }

            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                    continue;
                }
                if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.mp4') continue;

                fileCount++;
                const match = entry.name.match(/^(\d+)-/);
                if (!match) continue;

                const id = Number(match[1]);
                if (!Number.isSafeInteger(id) || id <= 0) {
                    console.warn('[INVALID ID] ' + entry.name);
                    continue;
                }

                validCount++;
                pending.push(id);
                if (pending.length >= BATCH_SIZE) {
                    newCount += database.insertMany(pending.splice(0, pending.length));
                }
            }
        }

        if (pending.length) newCount += database.insertMany(pending);

        console.log('扫描完成');
        console.log('MP4 文件：' + fileCount);
        console.log('有效 ID：' + validCount);
        console.log('新增 ID：' + newCount);
        console.log('数据库总数：' + database.count());
        console.log('无法读取目录：' + unreadableCount);
    } finally {
        database.close();
    }
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
