const path = require('path');

function resolvePath(variable, fallback) {
    return path.resolve(process.env[variable] || fallback);
}

module.exports = Object.freeze({
    TASK_FILE: resolvePath('TASK_FILE', 'task.txt'),
    DOWNLOAD_FILE: resolvePath('DOWNLOAD_FILE', 'download.txt'),
    RESULT_FILE: resolvePath('RESULT_FILE', 'result.txt'),
    CURRENT_BATCH_FILE: resolvePath('CURRENT_BATCH_FILE', 'current-batch.txt'),
    BLOB_FILE: resolvePath('BLOB_FILE', 'blob-manual.txt'),
    VIDEO_DB_FILE: resolvePath('VIDEO_DB_FILE', 'videos.db'),
    DOWNLOAD_SOURCE_ROOT: resolvePath('DOWNLOAD_SOURCE_ROOT', 'D:\\h'),
    DOWNLOAD_TARGET_ROOT: resolvePath('DOWNLOAD_TARGET_ROOT', 'G:\\h'),
    VIDEO_LIBRARY_ROOT: resolvePath('VIDEO_LIBRARY_ROOT', 'G:\\h')
});
