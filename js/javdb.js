const fs = require("fs");
const path = require("path");

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9222;

const TASK_FILE = path.join(__dirname, "task.txt");
const RESULT_FILE = path.join(__dirname, "result.txt");

const WAIT_SEARCH = 2000;
const WAIT_IFRAME = 2000;
const WAIT_LOAD_MORE = 1500;

const sleep = ms => new Promise(r => setTimeout(r, ms));


// ============================================================
// CDP
// ============================================================

let ws;
let messageId = 0;
const pending = new Map();

async function connectCDP() {
    const targets = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`).then(r => r.json());

    // 优先找正常网页 Tab
    const target = targets.find(x =>
        x.type === "page" &&
        x.webSocketDebuggerUrl
    );

    if (!target) {
        throw new Error("没有找到 Chrome 页面，请确认 Chrome 已使用 --remote-debugging-port=9222 启动");
    }

    console.log("连接页面:");
    console.log("  ", target.title);
    console.log("  ", target.url);

    ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });

    ws.onmessage = event => {
        const msg = JSON.parse(event.data);

        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);

            if (msg.error) {
                reject(new Error(JSON.stringify(msg.error)));
            } else {
                resolve(msg.result);
            }
        }
    };

    await cdp("Runtime.enable");
    await cdp("Page.enable");
}

function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++messageId;

        pending.set(id, { resolve, reject });

        ws.send(JSON.stringify({
            id,
            method,
            params
        }));
    });
}


async function evaluate(expression, awaitPromise = true) {
    const result = await cdp("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue: true
    });

    if (result.exceptionDetails) {
        throw new Error(
            result.exceptionDetails.exception?.description ||
            "Runtime.evaluate failed"
        );
    }

    return result.result?.value;
}


// ============================================================
// 页面操作
// ============================================================

async function search(keyword) {
    const code = `
        (() => {
            const input = document.querySelector('#video-search');

            if (!input) {
                return {
                    ok: false,
                    error: "找不到 #video-search"
                };
            }

            input.value = ${JSON.stringify(keyword)};

            // 某些网站监听 input/change 事件
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));

            const btn = document.querySelector('#search-submit');

            if (!btn) {
                return {
                    ok: false,
                    error: "找不到 #search-submit"
                };
            }

            btn.click();

            return {
                ok: true
            };
        })()
    `;

    return await evaluate(code);
}


async function clickFirstResult() {
    const code = `
        (() => {
            const img = document.querySelector('.box img');

            if (!img) {
                return {
                    ok: false,
                    error: "找不到 .box img"
                };
            }

            img.click();

            return {
                ok: true
            };
        })()
    `;

    return await evaluate(code);
}


// ============================================================
// 从 iframe 获取最佳评论中的链接
// ============================================================

async function extractLinkFromIframe() {
    const code = `
        (async () => {

            const iframe = Array.from(document.querySelectorAll('iframe'))
                .find(el => /^layui-layer-iframe\\\\d+$/.test(el.id))
                || document.querySelector('iframe');

            if (!iframe) {
                return {
                    ok: false,
                    error: "找不到 iframe"
                };
            }

            const doc = iframe.contentDocument ||
                        iframe.contentWindow?.document;

            if (!doc) {
                return {
                    ok: false,
                    error: "无法访问 iframe document"
                };
            }

            // ------------------------------------------------
            // 不断点击“加载更多评论”
            // ------------------------------------------------

            while (true) {
                const btn = doc.querySelector('#loadMoreReviews');

                if (!btn) {
                    break;
                }

                btn.scrollIntoView();
                btn.click();

                await new Promise(r => setTimeout(r, ${WAIT_LOAD_MORE}));
            }


            // ------------------------------------------------
            // 获取评论
            // ------------------------------------------------

            const reviews = [...doc.querySelectorAll('.review-content')]
                .map(el => el.textContent.trim())
                .filter(Boolean);


            function getPriority(text) {
                const lower = text.toLowerCase();

                if (lower.includes('ed2k') &&
                    lower.includes('4k')) {
                    return 3;
                }

                if (lower.includes('ed2k')) {
                    return 2;
                }

                if (lower.includes('magnet') ||
                    lower.includes('破解')) {
                    return 1;
                }

                return 0;
            }


            // ------------------------------------------------
            // 找优先级最高的评论
            // ------------------------------------------------

            let bestReview = null;
            let bestPriority = -1;

            for (const review of reviews) {
                const p = getPriority(review);

                if (p > bestPriority) {
                    bestPriority = p;
                    bestReview = review;

                    if (p === 3) {
                        break;
                    }
                }
            }


            if (!bestReview || bestPriority <= 0) {
                return {
                    ok: false,
                    error: "没有找到符合条件的评论",
                    reviewCount: reviews.length
                };
            }


            // ------------------------------------------------
            // 提取链接
            // ------------------------------------------------

            const match = bestReview.match(
                /(ed2k:\\/\\/[^\\\\s]+\\/|magnet:\\?xt=urn:btih:[0-9A-Fa-f]{32,40})/i
            );

            if (!match) {
                return {
                    ok: false,
                    error: "最佳评论中没有找到链接",
                    review: bestReview
                };
            }

            return {
                ok: true,
                link: match[0],
                priority: bestPriority,
                reviewCount: reviews.length
            };

        })()
    `;

    return await evaluate(code, true);
}


// ============================================================
// 关闭 iframe
// ============================================================

async function closeIframe() {
    return await evaluate(`
        (() => {
            const btn = document.querySelector('.layui-layer-close');

            if (btn) {
                btn.click();
                return true;
            }

            return false;
        })()
    `);
}


// ============================================================
// 主流程
// ============================================================

async function main() {

    if (!fs.existsSync(TASK_FILE)) {
        throw new Error(`找不到 ${TASK_FILE}`);
    }

    const tasks = fs.readFileSync(TASK_FILE, "utf8")
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

    if (tasks.length === 0) {
        console.log("task.txt 是空的");
        return;
    }

    console.log(`共 ${tasks.length} 个任务`);

    await connectCDP();

    console.log("CDP 连接成功\n");


    for (let i = 0; i < tasks.length; i++) {

        const keyword = tasks[i];

        console.log("==================================================");
        console.log(`[${i + 1}/${tasks.length}] ${keyword}`);
        console.log("==================================================");


        try {

            // ------------------------------------------------
            // 1. 搜索
            // ------------------------------------------------

            console.log("搜索...");

            const searchResult = await search(keyword);

            if (!searchResult.ok) {
                console.log("搜索失败:", searchResult.error);
                continue;
            }

            await sleep(WAIT_SEARCH);


            // ------------------------------------------------
            // 2. 点击第一个搜索结果
            // ------------------------------------------------

            console.log("打开第一个结果...");

            const result = await clickFirstResult();

            if (!result.ok) {
                console.log("打开结果失败:", result.error);
                continue;
            }

            await sleep(WAIT_IFRAME);


            // ------------------------------------------------
            // 3. iframe 中加载评论并提取链接
            // ------------------------------------------------

            console.log("读取 iframe...");

            const extracted = await extractLinkFromIframe();

            if (!extracted.ok) {

                console.log("未获得链接:", extracted.error);

                if (extracted.review) {
                    console.log("最佳评论:");
                    console.log(extracted.review);
                }

                await closeIframe();
                await sleep(500);

                continue;
            }


            // ------------------------------------------------
            // 4. 写入 result.txt
            //
            // 格式：
            // link<TAB>搜索词
            // ------------------------------------------------

            const line =
                extracted.link +
                "\\t" +
                keyword +
                "\\n";

            fs.appendFileSync(
                RESULT_FILE,
                line,
                "utf8"
            );


            console.log("获得链接:");
            console.log(extracted.link);

            console.log("已写入 result.txt");


            // ------------------------------------------------
            // 5. 关闭 iframe
            // ------------------------------------------------

            await closeIframe();
            await sleep(500);

        } catch (err) {

            console.log("处理失败:");
            console.log(err.message);

            // 尽量尝试关闭 iframe
            try {
                await closeIframe();
            } catch {}

        }
    }


    console.log("\n==================================================");
    console.log("全部任务处理完成");
    console.log(`结果文件: ${RESULT_FILE}`);
    console.log("==================================================");

    ws.close();
}


main().catch(err => {
    console.error("\n程序异常退出:");
    console.error(err);
    process.exit(1);
});