const { withPage } = require('./lib/browser');
const { readLines, writeLinesAtomic, appendLine } = require('./lib/queue');

const { TASK_FILE, RESULT_FILE } = require('./lib/config');

async function readLatestDetails(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const title = document.querySelector('h3')?.textContent.trim();
        const link = document.querySelector('.exoclick-popunder')?.getAttribute('data-url');
        return Boolean(title && link);
    }, { timeout: 120000 });

    return page.evaluate(() => ({
        title: document.querySelector('h3').textContent
            .trim().replace(/\s+/g, ' ').replace(/ \S+$/, ''),
        url: document.querySelector('.exoclick-popunder').getAttribute('data-url')
    }));
}

async function main() {
    const urls = readLines(TASK_FILE);
    writeLinesAtomic(RESULT_FILE, []);
    if (!urls.length) {
        console.log('task.txt 没有 URL。');
        return;
    }

    await withPage(async page => {
        for (const url of urls) {
            try {
                const result = await readLatestDetails(page, url);
                appendLine(RESULT_FILE, result.title + ' ' + result.url);
                console.log(result.title + ' ' + result.url);
            } catch (error) {
                console.error('[FAILED] ' + url + ': ' + error.message);
            }
        }
    });

    console.log('处理完成：' + RESULT_FILE);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
