const path = require('path');
const { withPage } = require('./lib/browser');
const { readLines, writeLinesAtomic, appendLine } = require('./lib/queue');
const { extractBestReviewLink, closeReviewFrame } = require('./lib/javdb-scraper');

const TASK_FILE = path.join(__dirname, 'task.txt');
const RESULT_FILE = path.join(__dirname, 'result.txt');

async function searchFirstResult(page, keyword) {
    await page.waitForSelector('#video-search', { timeout: 15000 });
    await page.$eval('#video-search', (input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, keyword);

    await page.click('#search-submit');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.waitForSelector('.box img', { timeout: 30000 });
    await page.click('.box img');
    return extractBestReviewLink(page);
}

async function main() {
    const tasks = readLines(TASK_FILE);
    writeLinesAtomic(RESULT_FILE, []);
    if (!tasks.length) {
        console.log('task.txt 没有搜索词。');
        return;
    }

    await withPage(async page => {
        await page.goto('https://javdb.com/', { waitUntil: 'domcontentloaded' });

        for (const [index, keyword] of tasks.entries()) {
            console.log('\n[' + (index + 1) + '/' + tasks.length + '] ' + keyword);

            try {
                const result = await searchFirstResult(page, keyword);
                if (!result.ok) {
                    console.warn('[NO LINK] ' + result.error);
                    if (result.review) console.log(result.review);
                    continue;
                }

                appendLine(RESULT_FILE, result.link + '\t' + keyword);
                console.log('[OK] ' + result.link);
            } catch (error) {
                console.error('[FAILED] ' + error.message);
            } finally {
                await closeReviewFrame(page);
            }
        }
    });

    console.log('\n完成：' + RESULT_FILE);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
