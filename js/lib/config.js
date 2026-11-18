const path = require('path');

function resolvePath(variable, fallback) {
    return path.resolve(process.env[variable] || fallback);
}

module.exports = Object.freeze({
    TASK_FILE: resolvePath('TASK_FILE', 'task.txt'),
    VIDEO_LINKS_FILE: resolvePath('VIDEO_LINKS_FILE', 'video-links.txt'),
    FILTERED_LINKS_FILE: resolvePath('FILTERED_LINKS_FILE', 'filtered-video-links.txt'),
    PLAYLIST_LINKS_FILE: resolvePath('PLAYLIST_LINKS_FILE', 'playlist-links.txt'),
    DOWNLOAD_FILE: resolvePath('DOWNLOAD_FILE', 'download.txt'),
    RUNNING_FILE: resolvePath('RUNNING_FILE', 'downloading.txt'),
    RETRY_FILE: resolvePath('RETRY_FILE', 'retry.txt'),
    VIDEO_DB_FILE: resolvePath('VIDEO_DB_FILE', 'videos.db'),
    DOWNLOAD_ROOT: resolvePath('DOWNLOAD_ROOT', process.env.DOWNLOAD_TARGET_ROOT || 'G:\\h'),
    VIDEO_LIBRARY_ROOT: resolvePath('VIDEO_LIBRARY_ROOT', 'G:\\h')
});
