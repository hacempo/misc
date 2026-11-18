const { runDownloadManager } = require('./lib/download-manager');

runDownloadManager().catch(error => {
    console.error('\n下载管理器终止：' + error.message);
    process.exitCode = 1;
});
