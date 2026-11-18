const fs = require('fs');
const path = require('path');

function readLines(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(line => line.trim());
}

function writeLinesAtomic(file, lines) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, lines.length ? lines.join('\r\n') + '\r\n' : '', 'utf8');
    fs.renameSync(temp, file);
}

function appendLine(file, line) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.appendFileSync(file, line + '\r\n', 'utf8');
}

function parseDownloadTasks(file) {
    const valid = [];
    const invalid = [];

    readLines(file).forEach((line, index) => {
        const fields = line.split('\t');
        if (fields.length !== 3) {
            invalid.push({ line, lineNumber: index + 1, reason: '格式应为 标题<TAB>下载URL<TAB>视频页URL' });
            return;
        }

        const [title, url, watchUrl] = fields.map(value => value.trim());
        if (!title || !url || !watchUrl) {
            invalid.push({ line, lineNumber: index + 1, reason: '标题或 URL 为空' });
            return;
        }

        try {
            if (!/^https?:$/.test(new URL(url).protocol) || !/^https?:$/.test(new URL(watchUrl).protocol)) {
                throw new Error('URL 必须使用 HTTP 或 HTTPS');
            }
        } catch (error) {
            invalid.push({ line, lineNumber: index + 1, reason: error.message || 'URL 无效' });
            return;
        }

        valid.push({ title, url, watchUrl, line });
    });

    return { valid, invalid };
}

function removeOriginalRows(file, items) {
    if (!items.length || !fs.existsSync(file)) return;

    const counts = new Map();
    for (const item of items) {
        counts.set(item.line, (counts.get(item.line) || 0) + 1);
    }

    const remaining = [];
    for (const line of readLines(file)) {
        const count = counts.get(line) || 0;
        if (count > 0) counts.set(line, count - 1);
        else remaining.push(line);
    }
    writeLinesAtomic(file, remaining);
}

module.exports = { readLines, writeLinesAtomic, appendLine, parseDownloadTasks, removeOriginalRows };
