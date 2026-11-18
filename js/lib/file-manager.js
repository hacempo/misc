const fs = require('fs');
const path = require('path');

function sanitizeFolderName(name) {
    const value = String(name || '')
        .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 180);
    return value || 'Unknown';
}

function ensureDirectory(name, root) {
    const base = path.resolve(root);
    const directory = path.resolve(base, sanitizeFolderName(name));
    if (directory === base || !directory.startsWith(base + path.sep)) {
        throw new Error('目录名超出下载根目录范围：' + name);
    }
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}

module.exports = { sanitizeFolderName, ensureDirectory };
