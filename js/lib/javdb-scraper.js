function getPriority(text) {
    const value = text.toLowerCase();
    if (value.includes('ed2k') && value.includes('4k')) return 3;
    if (value.includes('ed2k')) return 2;
    if (value.includes('magnet') || value.includes('破解')) return 1;
    return 0;
}

function extractLink(text) {
    const ed2k = text.match(/ed2k:\/\/[^\s"'<>]+/i);
    if (ed2k) return ed2k[0];

    const magnet = text.match(/magnet:\?xt=urn:btih:[0-9a-f]{32,64}(?:[&][^\s"'<>]*)?/i);
    return magnet ? magnet[0] : null;
}

async function getReviewFrame(page) {
    const iframe = await page.waitForSelector('iframe[id^="layui-layer-iframe"]', { timeout: 15000 })
        .catch(() => page.waitForSelector('.layui-layer iframe', { timeout: 5000 }));

    if (!iframe) throw new Error('找不到评论 iframe');

    const frame = await iframe.contentFrame();
    if (!frame) throw new Error('无法读取评论 iframe');
    await frame.waitForSelector('.review-content', { timeout: 20000 });
    return frame;
}

async function extractBestReviewLink(page, options = {}) {
    const maxPages = options.maxPages || 50;
    const delay = options.delay || 1500;
    const frame = await getReviewFrame(page);

    for (let index = 0; index < maxPages; index += 1) {
        const button = await frame.$('#loadMoreReviews');
        if (!button) break;

        const disabled = await button.evaluate(element =>
            element.disabled || element.getAttribute('aria-disabled') === 'true'
        );
        if (disabled) break;

        await button.evaluate(element => {
            element.scrollIntoView({ block: 'center' });
            element.click();
        });
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    const reviews = await frame.$$eval('.review-content', elements =>
        elements.map(element => element.textContent.trim()).filter(Boolean)
    );

    const best = reviews
        .map(text => ({ text, priority: getPriority(text) }))
        .filter(item => item.priority > 0)
        .sort((a, b) => b.priority - a.priority)[0];

    if (!best) {
        return { ok: false, error: '没有找到符合条件的评论', reviewCount: reviews.length };
    }

    const link = extractLink(best.text);
    if (!link) {
        return { ok: false, error: '最佳评论中没有找到链接', review: best.text, reviewCount: reviews.length };
    }

    return { ok: true, link, priority: best.priority, reviewCount: reviews.length };
}

async function closeReviewFrame(page) {
    const close = await page.$('.layui-layer-close');
    if (close) await close.click().catch(() => {});
}

module.exports = { getPriority, extractLink, extractBestReviewLink, closeReviewFrame };
