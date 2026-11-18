const puppeteer = require('puppeteer-core');

const BROWSER_URL = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';
const DEFAULT_TIMEOUT = 30000;

async function connectBrowser() {
    return puppeteer.connect({ browserURL: BROWSER_URL });
}

async function createPage(browser, timeout = DEFAULT_TIMEOUT) {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    return page;
}

async function closePage(page) {
    if (page && !page.isClosed()) {
        await page.close().catch(() => {});
    }
}

function disconnectBrowser(browser) {
    if (browser) browser.disconnect();
}

async function withPage(callback, timeout = DEFAULT_TIMEOUT) {
    let browser;
    let page;

    try {
        browser = await connectBrowser();
        page = await createPage(browser, timeout);
        return await callback(page, browser);
    } finally {
        await closePage(page);
        disconnectBrowser(browser);
    }
}

module.exports = {
    BROWSER_URL,
    connectBrowser,
    createPage,
    closePage,
    disconnectBrowser,
    withPage
};
