const { runBatchDownloader } = require('./lib/batch-downloader');

runBatchDownloader().catch(error => {
    console.error('\n批量下载终止：' + error.message);
    process.exitCode = error.name === 'BlobDiscoveredError' ? 2 : 1;
});
