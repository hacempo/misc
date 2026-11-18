const { runAria2Downloader } = require('./lib/aria2-downloader');

runAria2Downloader().catch(error => {
    console.error('\naria2 下载器终止：' + error.message);
    process.exitCode = 1;
});
