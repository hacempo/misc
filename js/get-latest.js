const fs = require('fs');
const puppeteer = require('puppeteer-core');

(async () => {
  const urls = fs.readFileSync('task.txt', 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  fs.writeFileSync('result.txt', '');

  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const page = await browser.newPage();

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() =>
        document.querySelector('h3')?.textContent.trim() &&
        document.querySelector('.exoclick-popunder')?.getAttribute('data-url'),
        { timeout: 120000 }
      );

      const title = await page.$eval('h3', el =>
        el.textContent.trim().replace(/\s+/g, ' ').replace(/ \S+$/, '')
      );
      const link = await page.$eval('.exoclick-popunder', el => el.getAttribute('data-url'));

      fs.appendFileSync('result.txt', `${title} ${link}\r\n`);
      console.log(`${title} ${link}`);
    } catch (e) {
      console.log(`失败：${url}`);
    }
  }

  await page.close();
  browser.disconnect();
})();