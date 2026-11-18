const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function readLines(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(line => line.trim());
}

function getTimestamp() {
    const date = new Date();
    const pad = value => String(value).padStart(2, '0');
    const millis = String(date.getMilliseconds()).padStart(3, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' +
        pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds()) + '-' + millis;
}

function backupExistingFile(file) {
    if (!fs.existsSync(file)) return null;

    const parsed = path.parse(path.resolve(file));
    const stamp = getTimestamp();
    let backup = path.join(parsed.dir, parsed.name + '.' + stamp + parsed.ext);
    let suffix = 1;
    while (fs.existsSync(backup)) {
        backup = path.join(parsed.dir, parsed.name + '.' + stamp + '.' + suffix + parsed.ext);
        suffix++;
    }

    fs.renameSync(file, backup);
    console.log('[BACKUP] ' + file + ' -> ' + backup);
    return backup;
}

function writeLinesRaw(file, lines) {
    const absolute = path.resolve(file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const temp = absolute + '.tmp-' + process.pid + '-' + randomUUID();
    fs.writeFileSync(temp, lines.length ? lines.join('\r\n') + '\r\n' : '', 'utf8');
    fs.renameSync(temp, absolute);
}

function writeLinesAtomic(file, lines) {
    backupExistingFile(file);
    writeLinesRaw(file, lines);
}

function appendLine(file, line) {
    writeLinesAtomic(file, [...readLines(file), line]);
}

function appendLinesUnique(file, additions) {
    const current = readLines(file);
    const merged = new Set(current);
    for (const line of additions) merged.add(line);
    const output = [...merged];
    if (output.length !== current.length) writeLinesAtomic(file, output);
}

function removeLines(file, linesToRemove) {
    if (!fs.existsSync(file) || !linesToRemove.length) return;
    const source = readLines(file);
    const counts = new Map();
    for (const line of linesToRemove) counts.set(line, (counts.get(line) || 0) + 1);

    const remaining = [];
    for (const line of source) {
        const count = counts.get(line) || 0;
        if (count > 0) counts.set(line, count - 1);
        else remaining.push(line);
    }
    if (remaining.length !== source.length) writeLinesAtomic(file, remaining);
}

function parseSendTasks(file) {
    const valid = [];
    const invalid = [];

    readLines(file).forEach((line, index) => {
        const fields = line.split('\t');
        if (fields.length !== 3) {
            invalid.push({ line, lineNumber: index + 1, reason: '格式应为 标题<TAB>下载URL<TAB>download页URL' });
            return;
        }

        const [title, url, downloadPageUrl] = fields.map(value => value.trim());
        if (!title || !url || !downloadPageUrl) {
            invalid.push({ line, lineNumber: index + 1, reason: '标题或 URL 为空' });
            return;
        }

        try {
            const source = new URL(url);
            const page = new URL(downloadPageUrl);
            if (!['http:', 'https:', 'blob:'].includes(source.protocol)) {
                throw new Error('真实下载 URL 协议无效');
            }
            if (page.hostname !== 'hanime1.me' || page.pathname !== '/download' ||
                !/^\d+$/.test(page.searchParams.get('v') || '')) {
                throw new Error('第三列必须是 Hanime download 页 URL');
            }
        } catch (error) {
            invalid.push({ line, lineNumber: index + 1, reason: error.message || 'URL 无效' });
            return;
        }

        valid.push({ title, url, downloadPageUrl, line });
    });

    return { valid, invalid };
}

module.exports = {
    readLines,
    writeLinesAtomic,
    appendLine,
    appendLinesUnique,
    removeLines,
    parseSendTasks
};
