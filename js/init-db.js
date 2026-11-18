const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const VIDEO_ROOT = "G:\\h";
const DB_FILE = "videos.db";


// ============================================================
// SQLite
// ============================================================

const db = new Database(DB_FILE);

db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY
    )
`);

const insertId = db.prepare(`
    INSERT OR IGNORE INTO videos (id)
    VALUES (?)
`);


// ============================================================
// 扫描目录
// ============================================================

let fileCount = 0;
let validCount = 0;
let newCount = 0;

function scanDirectory(dir) {

    const entries = fs.readdirSync(dir, {
        withFileTypes: true
    });

    for (const entry of entries) {

        const fullPath = path.join(
            dir,
            entry.name
        );

        if (entry.isDirectory()) {

            scanDirectory(fullPath);

            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        if (
            path.extname(entry.name).toLowerCase()
            !== ".mp4"
        ) {
            continue;
        }

        fileCount++;

        // ----------------------------------------------------
        // 文件名：
        //
        // 500704-1080p.mp4
        //
        // ↓
        //
        // 500704
        // ----------------------------------------------------

        const match =
            entry.name.match(/^(\d+)-/);

        if (!match) {
            // 乱码或其他无法识别的文件名
            continue;
        }

        const id = Number(match[1]);

        if (!Number.isSafeInteger(id)) {
            console.log(
                `[INVALID ID] ${entry.name}`
            );

            continue;
        }

        validCount++;

        const result = insertId.run(id);

        if (result.changes === 1) {
            newCount++;

            console.log(
                `[ADD] ${id} <- ${entry.name}`
            );
        }
    }
}


// ============================================================
// 开始扫描
// ============================================================

console.log(`扫描: ${VIDEO_ROOT}`);
console.log("");

if (!fs.existsSync(VIDEO_ROOT)) {
    console.error(
        `目录不存在: ${VIDEO_ROOT}`
    );

    process.exit(1);
}

scanDirectory(VIDEO_ROOT);


// ============================================================
// 结果
// ============================================================

console.log("");
console.log("==============================");
console.log("扫描完成");
console.log("==============================");
console.log(`MP4 文件:     ${fileCount}`);
console.log(`有效 ID:      ${validCount}`);
console.log(`新增数据库:   ${newCount}`);

const total = db
    .prepare("SELECT COUNT(*) AS count FROM videos")
    .get()
    .count;

console.log(`数据库总 ID:  ${total}`);

db.close();