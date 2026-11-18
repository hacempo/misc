const fs = require('fs');
const path = require('path');

function sanitizeFolderName(name) {
    return String(name || '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim() || 'Unknown';
}

function getSeriesName(title) {
    const value = String(title || '').trim();
    const index = value.lastIndexOf(' ');
    return index < 0 ? value : value.slice(0, index).trim();
}

function ensureDirectory(name, root = process.cwd()) {
    const dir = path.resolve(root, sanitizeFolderName(name));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function ensureSeriesDirectory(title, root = process.cwd()) {
    return ensureDirectory(getSeriesName(title), root);
}

function directoryExists(dir) {
    try {
        return fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

function getUniqueFilePath(file) {
    if (!fs.existsSync(file)) return file;

    const parsed = path.parse(file);
    for (let index = 1; ; index += 1) {
        const candidate = path.join(parsed.dir, parsed.name + ' (' + index + ')' + parsed.ext);
        if (!fs.existsSync(candidate)) return candidate;
    }
}

function mergeDirectoryContents(sourceDir, targetDir) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const source = path.join(sourceDir, entry.name);
        const target = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            if (fs.existsSync(target) && !directoryExists(target)) {
                throw new Error('目标路径是文件，无法合并目录：' + target);
            }
            if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
            mergeDirectoryContents(source, target);
            if (fs.readdirSync(source).length === 0) fs.rmSync(source, { recursive: true });
            continue;
        }

        if (entry.isFile()) {
            const finalPath = getUniqueFilePath(target);
            fs.copyFileSync(source, finalPath);
            fs.rmSync(source);
            continue;
        }

        console.warn('[SKIP] 不处理特殊文件：' + source);
    }
}

function mergeDirectory(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir) || !directoryExists(sourceDir)) {
        throw new Error('源目录不存在或不是目录：' + sourceDir);
    }

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        fs.cpSync(sourceDir, targetDir, { recursive: true, errorOnExist: true, force: false });
        fs.rmSync(sourceDir, { recursive: true });
        return;
    }

    if (!directoryExists(targetDir)) {
        throw new Error('目标路径不是目录：' + targetDir);
    }

    mergeDirectoryContents(sourceDir, targetDir);
    if (fs.readdirSync(sourceDir).length === 0) {
        fs.rmSync(sourceDir, { recursive: true });
    }
}

function mapDirectory(sourceDir, sourceRoot, targetRoot) {
    const source = path.resolve(sourceDir);
    const root = path.resolve(sourceRoot);
    const relative = path.relative(root, source);

    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('目录不在 SOURCE_ROOT 内：' + sourceDir);
    }

    return path.join(path.resolve(targetRoot), relative);
}

module.exports = {
    sanitizeFolderName,
    getSeriesName,
    ensureDirectory,
    ensureSeriesDirectory,
    directoryExists,
    mergeDirectory,
    mapDirectory
};
