// sort-downloads.js

const fs = require('fs');
const path = require('path');

const FILE = path.resolve('download.txt');

const text = fs.readFileSync(FILE, 'utf8');

const lines = text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean);

const groups = new Map();

for (const line of lines) {
    const index = line.indexOf('\t');

    if (index === -1) {
        console.warn('跳过格式错误的行：');
        console.warn(line);
        continue;
    }

    const url = line.slice(0, index).trim();
    const dir = line.slice(index + 1).trim();

    if (!url || !dir) {
        console.warn('跳过空 URL 或空目录：');
        console.warn(line);
        continue;
    }

    if (!groups.has(dir)) {
        groups.set(dir, []);
    }

    groups.get(dir).push({
        url,
        dir
    });
}

// 按每个目录的链接数量升序。
// 数量相同时保持原始出现顺序。
const sortedGroups = [...groups.entries()]
    .sort((a, b) => a[1].length - b[1].length);

const output = [];

for (const [, items] of sortedGroups) {
    for (const item of items) {
        output.push(`${item.url}\t${item.dir}`);
    }
}

fs.writeFileSync(
    FILE,
    output.join('\r\n') + (output.length ? '\r\n' : ''),
    'utf8'
);

console.log(`完成：${groups.size} 个目录，${output.length} 个链接`);

console.log('\n目录顺序：');

for (const [dir, items] of sortedGroups) {
    console.log(`${items.length}\t${dir}`);
}