const path = require('path');

function resolvePath(variable, fallback) {
    return path.resolve(process.env[variable] || fallback);
}

module.exports = Object.freeze({
    SEARCH_FILE: resolvePath('SEARCH_FILE', 'search.txt'),
    WATCH_FILE: resolvePath('WATCH_FILE', 'watch.txt'),
    DOWNLOAD_FILE: resolvePath('DOWNLOAD_FILE', 'download.txt'),
    SEND_FILE: resolvePath('SEND_FILE', 'send.txt'),
    SENDING_FILE: resolvePath('SENDING_FILE', 'sending.txt'),
    VIDEO_DB_FILE: resolvePath('VIDEO_DB_FILE', 'videos.db'),
    DOWNLOAD_ROOT: resolvePath('DOWNLOAD_ROOT', process.env.DOWNLOAD_TARGET_ROOT || 'G:\\h'),
    VIDEO_LIBRARY_ROOT: resolvePath('VIDEO_LIBRARY_ROOT', 'G:\\h')
});
