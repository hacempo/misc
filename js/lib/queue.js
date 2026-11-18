const fs = require('fs');

function readLines(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(line => line.trim());
}

function writeLinesAtomic(file, lines) {
    const temp = file + '.tmp';
    fs.writeFileSync(temp, lines.length ? lines.join('\r\n') + '\r\n' : '', 'utf8');
    fs.renameSync(temp, file);
}

function appendLine(file, line) {
    fs.appendFileSync(file, line + '\r\n', 'utf8');
}

function parseDownloadQueue(file) {
    const valid = [];
    const invalid = [];

    readLines(file).forEach((line, index) => {
        const tab = line.indexOf('\t');
        if (tab < 0) {
            invalid.push({ line, lineNumber: index + 1, reason: '缺少 TAB 分隔符' });
            return;
        }

        const url = line.slice(0, tab).trim();
        const dir = line.slice(tab + 1).trim();
        if (!url || !dir) {
            invalid.push({ line, lineNumber: index + 1, reason: 'URL 或目录为空' });
            return;
        }

        valid.push({ url, dir, line });
    });

    return { valid, invalid };
}

function removeOriginalRows(file, items) {
    if (!items.length || !fs.existsSync(file)) return;

    const removeCounts = new Map();
    for (const item of items) {
        if (!item.line) continue;
        removeCounts.set(item.line, (removeCounts.get(item.line) || 0) + 1);
    }

    const remaining = [];
    for (const line of readLines(file)) {
        const count = removeCounts.get(line) || 0;
        if (count > 0) removeCounts.set(line, count - 1);
        else remaining.push(line);
    }

    writeLinesAtomic(file, remaining);
}

function readBatch(file) {
    return readLines(file).flatMap(line => {
        const tab = line.indexOf('\t');
        if (tab < 0) return [];
        const url = line.slice(0, tab).trim();
        const dir = line.slice(tab + 1).trim();
        return url && dir ? [{ url, dir }] : [];
    });
}

function writeBatch(file, items) {
    writeLinesAtomic(file, items.map(item => item.url + '\t' + item.dir));
}

function appendDownloadTask(file, url, dir) {
    appendLine(file, url + '\t' + dir);
}

module.exports = {
    readLines,
    writeLinesAtomic,
    appendLine,
    parseDownloadQueue,
    removeOriginalRows,
    readBatch,
    writeBatch,
    appendDownloadTask
};
