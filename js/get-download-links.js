const fs = require('fs');
const path = require('path');
const CDP = require('chrome-remote-interface');

/*
 * ============================================================
 * 配置
 * ============================================================
 */

const TASK_FILE = path.resolve('task.txt');
const DOWNLOAD_FILE = path.resolve('download.txt');

const CDP_PORT = 9222;

const SEARCH_BASE =
    'https://hanime1.me/search?query=';

const SEARCH_SUFFIX =
    '&type=&genre=%E8%A3%8F%E7%95%AA&sort=&date=&duration=';


/*
 * ============================================================
 * 工具
 * ============================================================
 */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function readTasks() {
    if (!fs.existsSync(TASK_FILE)) {
        throw new Error(`找不到 ${TASK_FILE}`);
    }

    return fs.readFileSync(TASK_FILE, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}


function extractVideoId(href) {
    if (!href) {
        return null;
    }

    try {
        const url = new URL(href, 'https://hanime1.me');

        const id = url.searchParams.get('v');

        if (!id) {
            return null;
        }

        return id;
    } catch {
        return null;
    }
}


/*
 * ============================================================
 * CDP
 * ============================================================
 */

async function createTab() {
    const target = await CDP.New({
        port: CDP_PORT,
        url: 'about:blank'
    });

    const client = await CDP({
        port: CDP_PORT,
        target
    });

    await client.Runtime.enable();

    return {
        target,
        client
    };
}


async function closeTab(target, client) {
    try {
        await client.close();
    } catch {
        // 忽略连接关闭错误
    }

    try {
        await CDP.Close({
            port: CDP_PORT,
            id: target.id
        });
    } catch {
        // 忽略关闭 tab 错误
    }
}


/*
 * ============================================================
 * 页面操作
 * ============================================================
 */

async function evaluate(client, expression) {
    const result = await client.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true
    });

    if (result.exceptionDetails) {
        throw new Error(
            result.exceptionDetails.text ||
            'Runtime.evaluate 执行失败'
        );
    }

    return result.result.value;
}


async function navigate(client, url) {
    console.log(`\n打开：${url}`);

    const escapedUrl = JSON.stringify(url);

    await evaluate(
        client,
        `location.href = ${escapedUrl}`
    );
}


async function waitForPage(client, selector, timeout = 30000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const result = await evaluate(
            client,
            `(() => {
                return {
                    readyState: document.readyState,
                    exists: !!document.querySelector(${JSON.stringify(selector)})
                };
            })()`
        );

        if (
            result &&
            result.exists &&
            (
                result.readyState === 'interactive' ||
                result.readyState === 'complete'
            )
        ) {
            return true;
        }

        await sleep(300);
    }

    return false;
}


/*
 * ============================================================
 * 搜索页面
 * ============================================================
 */

async function getVideoIds(client, task) {
    const searchUrl =
        SEARCH_BASE +
        encodeURIComponent(task) +
        SEARCH_SUFFIX;

    await navigate(client, searchUrl);

    const ready = await waitForPage(
        client,
        '.home-rows-videos-wrapper',
        30000
    );

    if (!ready) {
        throw new Error(
            '等待 .home-rows-videos-wrapper 超时'
        );
    }

    // 再稍微等一下，避免页面刚出现容器但 children 还没有完全生成
    await sleep(500);

    const hrefs = await evaluate(
        client,
        `(() => {
            const wrapper =
                document.querySelector(
                    '.home-rows-videos-wrapper'
                );

            if (!wrapper) {
                return [];
            }

            return Array.from(wrapper.children)
                .map(el => el.href || el.getAttribute('href'))
                .filter(Boolean);
        })()`
    );

    if (!Array.isArray(hrefs)) {
        return [];
    }

    const ids = [];

    for (const href of hrefs) {
        const id = extractVideoId(href);

        if (id) {
            ids.push(id);
        }
    }

    // 同一个搜索结果页面如果出现重复 ID，只处理一次
    return [...new Set(ids)];
}


/*
 * ============================================================
 * 下载页面
 * ============================================================
 */

async function getDownloadUrl(client, id) {
    const downloadUrl =
        `https://hanime1.me/download?v=${encodeURIComponent(id)}`;

    await navigate(client, downloadUrl);

    const ready = await waitForPage(
        client,
        '.exoclick-popunder',
        30000
    );

    if (!ready) {
        throw new Error(
            '等待 .exoclick-popunder 超时'
        );
    }

    // 页面加载后再给一点时间，确保 data-url 已经写入
    await sleep(500);

    const result = await evaluate(
        client,
        `(() => {
            const element =
                document.querySelector(
                    '.exoclick-popunder'
                );

            if (!element) {
                return null;
            }

            return element.getAttribute('data-url');
        })()`
    );

    if (!result) {
        throw new Error(
            '第一个 .exoclick-popunder 没有 data-url'
        );
    }

    return result;
}


/*
 * ============================================================
 * 主程序
 * ============================================================
 */

async function main() {
    const tasks = readTasks();

    console.log(`读取 task.txt：${tasks.length} 条`);

    // 每次重新生成
    fs.writeFileSync(
        DOWNLOAD_FILE,
        '',
        'utf8'
    );

    const seen = new Set();

    let totalTasks = 0;
    let totalVideos = 0;
    let totalDownloads = 0;
    let totalErrors = 0;

    const { target, client } = await createTab();

    try {
        for (const task of tasks) {
            totalTasks++;

            console.log('\n========================================');
            console.log(`搜索 [${totalTasks}/${tasks.length}]：${task}`);
            console.log('========================================');

            let videoIds;

            try {
                videoIds = await getVideoIds(
                    client,
                    task
                );
            } catch (error) {
                totalErrors++;

                console.error(
                    `搜索失败：${error.message}`
                );

                continue;
            }

            console.log(
                `找到 ${videoIds.length} 个视频`
            );

            if (videoIds.length === 0) {
                continue;
            }

            for (const id of videoIds) {
                totalVideos++;

                console.log(
                    `\n处理 ID：${id}`
                );

                try {
                    const url =
                        await getDownloadUrl(
                            client,
                            id
                        );

                    const key =
                        `${url}\t${task}`;

                    if (seen.has(key)) {
                        console.log(
                            '重复，跳过'
                        );

                        continue;
                    }

                    seen.add(key);

                    fs.appendFileSync(
                        DOWNLOAD_FILE,
                        `${url}\t${task}\n`,
                        'utf8'
                    );

                    totalDownloads++;

                    console.log(
                        `下载链接：${url}`
                    );

                    console.log(
                        `已写入 download.txt`
                    );

                } catch (error) {
                    totalErrors++;

                    console.error(
                        `ID ${id} 获取失败：${error.message}`
                    );
                }
            }
        }

    } finally {
        await closeTab(
            target,
            client
        );
    }

    console.log('\n========================================');
    console.log('全部完成');
    console.log('========================================');
    console.log(`搜索词：${totalTasks}`);
    console.log(`视频数：${totalVideos}`);
    console.log(`下载链接：${totalDownloads}`);
    console.log(`错误：${totalErrors}`);
    console.log(`输出：${DOWNLOAD_FILE}`);
}


main().catch(error => {
    console.error('\n程序终止：');
    console.error(error);
    process.exit(1);
});
