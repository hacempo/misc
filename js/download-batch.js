const fs = require('fs');
const path = require('path');


/*
 * ============================================================
 * 配置
 * ============================================================
 */

const DOWNLOAD_FILE =
    path.resolve('download.txt');

const CURRENT_BATCH_FILE =
    path.resolve('current-batch.txt');

const BLOB_FILE =
    path.resolve('blob-manual.txt');


/*
 * ============================================================
 * aria2 RPC
 * ============================================================
 */

const RPC_URL =
    'http://127.0.0.1:29000/jsonrpc';

const RPC_TOKEN =
    process.env.TOKEN;


/*
 * ============================================================
 * Chrome CDP
 * ============================================================
 */

const CDP_HOST =
    '127.0.0.1';

const CDP_PORT =
    9222;

const CDP_BASE_URL =
    `http://${CDP_HOST}:${CDP_PORT}`;


/*
 * ============================================================
 * 下载目录
 * ============================================================
 */

const SOURCE_ROOT =
    path.resolve('D:\\h');

const TARGET_ROOT =
    path.resolve('G:\\h');


/*
 * ============================================================
 * Batch
 * ============================================================
 */

const MAX_URLS_PER_BATCH = 5;


/*
 * ============================================================
 * aria2
 * ============================================================
 */

const POLL_INTERVAL = 3000;

const ADD_INTERVAL = 200;

const ARIA2_MAX_TRIES = 5;

const ARIA2_RETRY_WAIT = 5;


/*
 * ============================================================
 * CDP
 * ============================================================
 */

const CDP_PAGE_TIMEOUT = 30000;


/*
 * ============================================================
 * 停止状态
 * ============================================================
 */

let stopping = false;


/*
 * ============================================================
 * 特殊错误：CDP 找到 blob
 *
 * blob 会进入 blob-manual.txt，
 * 从 download.txt 删除，
 * 当前 Batch 停止。
 * ============================================================
 */

class BlobDiscoveredError extends Error {

    constructor(message) {

        super(message);

        this.name =
            'BlobDiscoveredError';
    }
}


/*
 * ============================================================
 * HTTP 410
 * ============================================================
 */

function isHttp410(task) {

    const errorCode =
        String(task.errorCode || '');

    const errorMessage =
        String(task.errorMessage || '')
            .toLowerCase();

    return (
        errorCode === '22' &&
        /http\s*410/.test(errorMessage)
    );
}


/*
 * ============================================================
 * 基础函数
 * ============================================================
 */

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(resolve, ms)
    );
}


function directoryExists(dir) {

    try {

        return fs.statSync(dir).isDirectory();

    } catch {

        return false;
    }
}


/*
 * ============================================================
 * aria2 RPC
 * ============================================================
 */

async function rpc(
    method,
    params = []
) {

    const body = {

        jsonrpc: '2.0',

        id:
            Date.now() +
            Math.random(),

        method,

        params: [
            `token:${RPC_TOKEN}`,
            ...params
        ]
    };


    const response =
        await fetch(
            RPC_URL,
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                body:
                    JSON.stringify(body)
            }
        );


    if (!response.ok) {

        throw new Error(
            `aria2 RPC HTTP 错误：${response.status} ${response.statusText}`
        );
    }


    const data =
        await response.json();


    if (data.error) {

        throw new Error(
            `aria2 RPC 错误 ${data.error.code}: ${data.error.message}`
        );
    }


    return data.result;
}


/*
 * ============================================================
 * 读取 download.txt
 * ============================================================
 */

function readDownloadFile() {

    if (
        !fs.existsSync(
            DOWNLOAD_FILE
        )
    ) {

        return [];
    }


    const text =
        fs.readFileSync(
            DOWNLOAD_FILE,
            'utf8'
        );


    const lines =
        text
            .split(/\r?\n/)
            .map(
                line =>
                    line.trimEnd()
            )
            .filter(Boolean);


    const items = [];


    for (
        const line
        of lines
    ) {

        const index =
            line.indexOf('\t');


        if (index === -1) {

            console.warn(
                '跳过格式错误的行：'
            );

            console.warn(line);

            continue;
        }


        const url =
            line
                .slice(0, index)
                .trim();


        const dir =
            line
                .slice(index + 1)
                .trim();


        if (
            !url ||
            !dir
        ) {

            console.warn(
                '跳过空 URL 或空目录：'
            );

            console.warn(line);

            continue;
        }


        items.push({

            url,

            dir,

            /*
             * 永久保存原始行。
             */
            line
        });
    }


    return items;
}


/*
 * ============================================================
 * 从 URL 提取 Hanime 视频 ID
 *
 * 支持：
 *
 * https://hanime1.me/watch?v=22539
 *
 * https://hanime1.me/download?v=22539
 *
 * https://xxx/22539-720p.mp4
 * ============================================================
 */

function extractHanimeVideoId(url) {

    try {

        const parsed =
            new URL(url);


        /*
         * 第一优先：v 参数
         */
        const queryId =
            parsed.searchParams.get('v');


        if (
            queryId &&
            /^\d+$/.test(queryId)
        ) {

            return queryId;
        }


        /*
         * 第二优先：
         *
         * /22539-720p.mp4
         */
        const match =
            parsed.pathname.match(
                /\/(\d+)-[^/]+\.mp4$/i
            );


        if (
            match
        ) {

            return match[1];
        }


        /*
         * 第三优先：
         *
         * 只要路径最后存在数字-xxx.mp4
         */
        const looseMatch =
            parsed.pathname.match(
                /(\d+)-[^/]+\.mp4/i
            );


        if (
            looseMatch
        ) {

            return looseMatch[1];
        }


        return null;

    } catch {

        return null;
    }
}


/*
 * ============================================================
 * current-batch.txt
 * ============================================================
 */

function readCurrentBatchFile() {

    if (
        !fs.existsSync(
            CURRENT_BATCH_FILE
        )
    ) {

        return [];
    }


    const text =
        fs.readFileSync(
            CURRENT_BATCH_FILE,
            'utf8'
        );


    const lines =
        text
            .split(/\r?\n/)
            .map(
                line =>
                    line.trimEnd()
            )
            .filter(Boolean);


    const items = [];


    for (
        const line
        of lines
    ) {

        const index =
            line.indexOf('\t');


        if (
            index === -1
        ) {

            console.warn(
                `current-batch.txt 存在格式错误行：${line}`
            );

            continue;
        }


        const url =
            line
                .slice(0, index)
                .trim();


        const dir =
            line
                .slice(index + 1)
                .trim();


        if (
            !url ||
            !dir
        ) {

            continue;
        }


        items.push({
            url,
            dir
        });
    }


    return items;
}


/*
 * ============================================================
 * 根据 current-batch 恢复 download.txt 原始项目
 * ============================================================
 */

function restoreBatchFromCurrent(
    currentItems,
    downloadItems
) {

    const result = [];

    const used =
        new Set();


    for (
        const currentItem
        of currentItems
    ) {

        let found = null;


        /*
         * 第一优先：
         *
         * URL + 目录完全相同
         */
        for (
            let i = 0;
            i < downloadItems.length;
            i++
        ) {

            if (
                used.has(i)
            ) {

                continue;
            }


            const item =
                downloadItems[i];


            if (
                item.url ===
                    currentItem.url &&
                item.dir ===
                    currentItem.dir
            ) {

                found = {
                    ...item,
                    url:
                        currentItem.url
                };

                used.add(i);

                break;
            }
        }


        /*
         * 第二优先：
         *
         * Hanime 视频 ID + 目录
         */
        if (
            !found
        ) {

            const currentId =
                extractHanimeVideoId(
                    currentItem.url
                );


            if (
                currentId
            ) {

                for (
                    let i = 0;
                    i < downloadItems.length;
                    i++
                ) {

                    if (
                        used.has(i)
                    ) {

                        continue;
                    }


                    const item =
                        downloadItems[i];


                    if (
                        item.dir !==
                        currentItem.dir
                    ) {

                        continue;
                    }


                    const itemId =
                        extractHanimeVideoId(
                            item.url
                        );


                    if (
                        itemId ===
                        currentId
                    ) {

                        found = {

                            ...item,

                            url:
                                currentItem.url
                        };


                        used.add(i);

                        break;
                    }
                }
            }
        }


        if (
            !found
        ) {

            throw new Error(
                `无法从 download.txt 找回 current-batch 项目：\n` +
                `${currentItem.url}\t${currentItem.dir}`
            );
        }


        result.push(found);
    }


    return result;
}


/*
 * ============================================================
 * 写 current-batch.txt
 * ============================================================
 */

function writeCurrentBatchFile(
    batch
) {

    const text =
        batch
            .map(
                item =>
                    `${item.url}\t${item.dir}`
            )
            .join('\r\n');


    const tempFile =
        CURRENT_BATCH_FILE +
        '.tmp';


    fs.writeFileSync(
        tempFile,

        text
            ? text + '\r\n'
            : '',

        'utf8'
    );


    fs.renameSync(
        tempFile,
        CURRENT_BATCH_FILE
    );
}


function clearCurrentBatchFile() {

    fs.writeFileSync(
        CURRENT_BATCH_FILE,
        '',
        'utf8'
    );
}


function hasPendingCurrentBatch() {

    if (
        !fs.existsSync(
            CURRENT_BATCH_FILE
        )
    ) {

        return false;
    }


    const text =
        fs.readFileSync(
            CURRENT_BATCH_FILE,
            'utf8'
        ).trim();


    return text.length > 0;
}


/*
 * ============================================================
 * blob
 * ============================================================
 */

function isBlobUrl(url) {

    return String(url || '')
        .trim()
        .toLowerCase()
        .startsWith('blob:');
}


function appendBlobItems(
    items
) {

    if (
        !items.length
    ) {

        return;
    }


    const lines =
        items.map(
            item =>
                `${item.url}\t${item.dir}`
        );


    fs.appendFileSync(
        BLOB_FILE,

        lines.join('\r\n') +
        '\r\n',

        'utf8'
    );


    console.log(
        `发现 ${items.length} 个 blob 链接，已保存到：${BLOB_FILE}`
    );
}


/*
 * ============================================================
 * 从 download.txt 删除指定原始行
 * ============================================================
 */

function removeBatchFromDownloadFile(
    batch
) {

    if (
        !batch.length
    ) {

        return;
    }


    if (
        !fs.existsSync(
            DOWNLOAD_FILE
        )
    ) {

        return;
    }


    const text =
        fs.readFileSync(
            DOWNLOAD_FILE,
            'utf8'
        );


    const lines =
        text
            .split(/\r?\n/)
            .map(
                line =>
                    line.trimEnd()
            )
            .filter(Boolean);


    const removeCounts =
        new Map();


    for (
        const item
        of batch
    ) {

        const key =
            item.line;


        removeCounts.set(
            key,
            (removeCounts.get(key) || 0) + 1
        );
    }


    const output = [];


    for (
        const line
        of lines
    ) {

        const count =
            removeCounts.get(line) || 0;


        if (
            count > 0
        ) {

            removeCounts.set(
                line,
                count - 1
            );

            continue;
        }


        output.push(line);
    }


    fs.writeFileSync(
        DOWNLOAD_FILE,

        output.length
            ? output.join('\r\n') + '\r\n'
            : '',

        'utf8'
    );
}


/*
 * ============================================================
 * Batch
 * ============================================================
 */

function buildNextBatch(
    items
) {

    if (
        !items.length
    ) {

        return [];
    }


    const groups =
        groupByDirectory(items);


    const batch = [];


    for (
        const [, groupItems]
        of groups
    ) {

        /*
         * 第一个目录无条件加入。
         *
         * 即使超过 MAX_URLS_PER_BATCH，
         * 也不能拆目录。
         */
        if (
            !batch.length
        ) {

            batch.push(
                ...groupItems
            );

            continue;
        }


        /*
         * 不允许拆目录。
         */
        if (
            batch.length +
            groupItems.length
            >
            MAX_URLS_PER_BATCH
        ) {

            break;
        }


        batch.push(
            ...groupItems
        );
    }


    return batch;
}


function groupByDirectory(
    items
) {

    const groups =
        new Map();


    for (
        const item
        of items
    ) {

        if (
            !groups.has(
                item.dir
            )
        ) {

            groups.set(
                item.dir,
                []
            );
        }


        groups
            .get(item.dir)
            .push(item);
    }


    return groups;
}


/*
 * ============================================================
 * aria2 添加任务
 * ============================================================
 */

async function addUri(
    url,
    dir
) {

    const options = {

        dir,

        'max-tries':
            String(ARIA2_MAX_TRIES),

        'retry-wait':
            String(ARIA2_RETRY_WAIT),

        'connect-timeout':
            '20',

        timeout:
            '60',

        continue:
            'true',

        'auto-file-renaming':
            'false'
    };


    return await rpc(
        'aria2.addUri',
        [
            [url],
            options
        ]
    );
}


/*
 * ============================================================
 * 获取任务状态
 * ============================================================
 */

async function getTasksByGids(
    gids
) {

    const result =
        new Map();


    if (
        !gids.length
    ) {

        return result;
    }


    /*
     * Active
     */
    const active =
        await rpc(
            'aria2.tellActive',
            [[
                'gid',
                'status',
                'totalLength',
                'completedLength',
                'errorCode',
                'errorMessage',
                'files'
            ]]
        );


    for (
        const task
        of active
    ) {

        if (
            gids.includes(task.gid)
        ) {

            result.set(
                task.gid,
                task
            );
        }
    }


    /*
     * Waiting
     */
    const waiting =
        await rpc(
            'aria2.tellWaiting',
            [
                0,
                1000,
                [
                    'gid',
                    'status',
                    'totalLength',
                    'completedLength',
                    'errorCode',
                    'errorMessage',
                    'files'
                ]
            ]
        );


    for (
        const task
        of waiting
    ) {

        if (
            gids.includes(task.gid)
        ) {

            result.set(
                task.gid,
                task
            );
        }
    }


    /*
     * Stopped
     */
    let offset = 0;


    while (true) {

        const stopped =
            await rpc(
                'aria2.tellStopped',
                [
                    offset,
                    1000,
                    [
                        'gid',
                        'status',
                        'totalLength',
                        'completedLength',
                        'errorCode',
                        'errorMessage',
                        'files'
                    ]
                ]
            );


        if (
            !stopped.length
        ) {

            break;
        }


        for (
            const task
            of stopped
        ) {

            if (
                gids.includes(
                    task.gid
                )
            ) {

                result.set(
                    task.gid,
                    task
                );
            }
        }


        if (
            stopped.length < 1000
        ) {

            break;
        }


        offset +=
            stopped.length;
    }


    return result;
}


/*
 * ============================================================
 * 打印进度
 * ============================================================
 */

function printTaskProgress(
    tasks,
    gids
) {

    let complete = 0;
    let active = 0;
    let waiting = 0;
    let error = 0;
    let removed = 0;
    let unknown = 0;


    for (
        const gid
        of gids
    ) {

        const task =
            tasks.get(gid);


        if (
            !task
        ) {

            unknown++;

            continue;
        }


        switch (
            task.status
        ) {

            case 'complete':
                complete++;
                break;

            case 'active':
                active++;
                break;

            case 'waiting':
                waiting++;
                break;

            case 'error':
                error++;
                break;

            case 'removed':
                removed++;
                break;

            default:
                unknown++;
                break;
        }
    }


    console.log(
        `Batch 状态：` +
        `完成 ${complete}/${gids.length}，` +
        `下载中 ${active}，` +
        `等待 ${waiting}，` +
        `错误 ${error}，` +
        `删除 ${removed}` +
        (
            unknown
                ? `，未知 ${unknown}`
                : ''
        )
    );
}


/*
 * ============================================================
 * 等待 Batch
 * ============================================================
 */

async function waitForBatch(
    gids
) {

    while (true) {

        if (
            stopping
        ) {

            throw new Error(
                '脚本正在停止。'
            );
        }


        /*
         * 理论上可能因为 blob 被移除后变成空 Batch。
         */
        if (
            !gids.length
        ) {

            return {
                completed: true,
                failed: []
            };
        }


        const tasks =
            await getTasksByGids(
                gids
            );


        printTaskProgress(
            tasks,
            gids
        );


        let completed = 0;

        const failed = [];


        for (
            const gid
            of gids
        ) {

            const task =
                tasks.get(gid);


            if (
                !task
            ) {

                continue;
            }


            if (
                task.status ===
                'complete'
            ) {

                completed++;

                continue;
            }


            if (
                task.status === 'error' ||
                task.status === 'removed'
            ) {

                failed.push({
                    gid,
                    task
                });
            }
        }


        if (
            failed.length
        ) {

            return {
                completed: false,
                failed
            };
        }


        if (
            completed ===
            gids.length
        ) {

            return {
                completed: true,
                failed: []
            };
        }


        await sleep(
            POLL_INTERVAL
        );
    }
}


/*
 * ============================================================
 * CDP
 * ============================================================
 */

async function createCDPTarget() {

    const targetUrl =
        `${CDP_BASE_URL}/json/new?about:blank`;


    console.log(
        `创建 CDP 新标签页：${targetUrl}`
    );


    let response;


    try {

        response =
            await fetch(
                targetUrl,
                {
                    method: 'PUT'
                }
            );

    } catch (error) {

        throw new Error(
            `创建 CDP 标签页失败：${error.message}`
        );
    }


    if (
        !response.ok
    ) {

        const text =
            await response
                .text()
                .catch(
                    () => ''
                );


        throw new Error(
            `创建 CDP 标签页失败：HTTP ${response.status} ${text}`
        );
    }


    let target;


    try {

        target =
            await response.json();

    } catch (error) {

        throw new Error(
            `CDP /json/new 返回内容不是 JSON：${error.message}`
        );
    }


    if (
        !target.id
    ) {

        throw new Error(
            `CDP /json/new 没有返回 target id：${JSON.stringify(target)}`
        );
    }


    if (
        !target.webSocketDebuggerUrl
    ) {

        throw new Error(
            `CDP /json/new 没有返回 webSocketDebuggerUrl：${JSON.stringify(target)}`
        );
    }


    console.log(
        `CDP 标签页已创建：${target.id}`
    );


    return target;
}


async function connectCDP(
    webSocketDebuggerUrl
) {

    console.log(
        `连接 CDP WebSocket：${webSocketDebuggerUrl}`
    );


    const ws =
        new WebSocket(
            webSocketDebuggerUrl
        );


    await new Promise(
        (resolve, reject) => {

            let settled = false;


            const timer =
                setTimeout(
                    () => {

                        if (
                            settled
                        ) {

                            return;
                        }


                        settled = true;


                        try {
                            ws.close();
                        } catch {}


                        reject(
                            new Error(
                                'CDP WebSocket 连接超时'
                            )
                        );

                    },
                    CDP_PAGE_TIMEOUT
                );


            ws.addEventListener(
                'open',
                () => {

                    if (
                        settled
                    ) {

                        return;
                    }


                    settled = true;

                    clearTimeout(
                        timer
                    );


                    console.log(
                        'CDP WebSocket 已连接'
                    );


                    resolve();
                }
            );


            ws.addEventListener(
                'error',
                error => {

                    if (
                        settled
                    ) {

                        return;
                    }


                    settled = true;

                    clearTimeout(
                        timer
                    );


                    reject(
                        new Error(
                            `CDP WebSocket 连接失败：${error.message || error}`
                        )
                    );
                }
            );


            ws.addEventListener(
                'close',
                () => {

                    if (
                        settled
                    ) {

                        return;
                    }


                    settled = true;

                    clearTimeout(
                        timer
                    );


                    reject(
                        new Error(
                            'CDP WebSocket 在连接过程中关闭'
                        )
                    );
                }
            );
        }
    );


    return ws;
}


let cdpCommandId = 0;


async function cdpCall(
    ws,
    method,
    params = {},
    timeout = CDP_PAGE_TIMEOUT
) {

    const id =
        ++cdpCommandId;


    return await new Promise(
        (resolve, reject) => {

            let settled = false;


            const cleanup = () => {

                clearTimeout(
                    timer
                );


                try {

                    ws.removeEventListener(
                        'message',
                        onMessage
                    );

                    ws.removeEventListener(
                        'error',
                        onError
                    );

                    ws.removeEventListener(
                        'close',
                        onClose
                    );

                } catch {}
            };


            const finishResolve =
                value => {

                    if (
                        settled
                    ) {

                        return;
                    }


                    settled = true;

                    cleanup();

                    resolve(value);
                };


            const finishReject =
                error => {

                    if (
                        settled
                    ) {

                        return;
                    }


                    settled = true;

                    cleanup();

                    reject(error);
                };


            const onMessage =
                event => {

                    let message;


                    try {

                        message =
                            JSON.parse(
                                event.data
                            );

                    } catch {

                        return;
                    }


                    if (
                        message.id !== id
                    ) {

                        return;
                    }


                    if (
                        message.error
                    ) {

                        finishReject(
                            new Error(
                                `CDP ${method} 错误：${message.error.message || JSON.stringify(message.error)}`
                            )
                        );

                        return;
                    }


                    finishResolve(
                        message.result
                    );
                };


            const onError =
                error => {

                    finishReject(
                        new Error(
                            `CDP ${method} WebSocket 错误：${error.message || error}`
                        )
                    );
                };


            const onClose =
                () => {

                    finishReject(
                        new Error(
                            `CDP ${method}：WebSocket 已关闭`
                        )
                    );
                };


            const timer =
                setTimeout(
                    () => {

                        finishReject(
                            new Error(
                                `CDP 调用超时：${method}`
                            )
                        );

                    },
                    timeout
                );


            ws.addEventListener(
                'message',
                onMessage
            );

            ws.addEventListener(
                'error',
                onError
            );

            ws.addEventListener(
                'close',
                onClose
            );


            try {

                ws.send(
                    JSON.stringify({
                        id,
                        method,
                        params
                    })
                );

            } catch (error) {

                finishReject(
                    new Error(
                        `发送 CDP ${method} 失败：${error.message}`
                    )
                );
            }
        }
    );
}


async function cdpEvaluate(
    ws,
    expression
) {

    const result =
        await cdpCall(
            ws,
            'Runtime.evaluate',
            {
                expression,
                returnByValue: true,
                awaitPromise: true
            }
        );


    if (
        result &&
        result.exceptionDetails
    ) {

        throw new Error(
            `Runtime.evaluate 执行失败：${JSON.stringify(result.exceptionDetails)}`
        );
    }


    return result?.result?.value;
}


/*
 * ============================================================
 * Runtime 导航
 * ============================================================
 */

async function navigateByRuntime(
    ws,
    url
) {

    const encodedUrl =
        JSON.stringify(url);


    console.log(
        `通过 Runtime.evaluate 导航：${url}`
    );


    await cdpEvaluate(
        ws,
        `
        (() => {
            location.href = ${encodedUrl};
            return true;
        })()
        `
    );


    console.log(
        '导航指令已经交给浏览器'
    );
}


/*
 * ============================================================
 * 等待 Hanime 下载页中的最高画质 URL
 *
 * 新逻辑：
 *
 * 第一个：
 *
 * .exoclick-popunder.juicyads-popunder
 *
 * 的：
 *
 * data-url
 *
 * 就是目标 URL。
 *
 * 如果 data-url 是 blob:
 * 原样返回给外部处理。
 * ============================================================
 */

async function waitForDownloadPageSource(
    ws
) {

    const start =
        Date.now();


    let lastState = '';


    while (
        Date.now() - start <
        CDP_PAGE_TIMEOUT
    ) {

        if (
            stopping
        ) {

            throw new Error(
                '用户中止'
            );
        }


        try {

            const result =
                await cdpEvaluate(
                    ws,
                    `
                    (() => {

                        const element =
                            document.querySelector(
                                '.exoclick-popunder.juicyads-popunder'
                            );


                        if (!element) {

                            return {
                                found: false,
                                reason: 'download-element-not-found',
                                href: location.href
                            };
                        }


                        const dataUrl =
                            element.getAttribute(
                                'data-url'
                            ) ||
                            '';


                        if (!dataUrl) {

                            return {
                                found: false,
                                reason: 'data-url-empty',
                                href: location.href
                            };
                        }


                        return {
                            found: true,
                            src: dataUrl,
                            isBlob:
                                dataUrl
                                    .toLowerCase()
                                    .startsWith('blob:'),
                            href: location.href
                        };

                    })()
                    `
                );


            const state =
                JSON.stringify(
                    result
                );


            if (
                state !==
                lastState
            ) {

                lastState =
                    state;


                console.log(
                    `CDP 下载页状态：${state}`
                );
            }


            if (
                result &&
                result.found &&
                result.src
            ) {

                return result.src;
            }

        } catch (error) {

            /*
             * 页面导航过程中 Runtime.evaluate
             * 可能暂时不可用。
             */
            console.log(
                `等待下载页时 CDP 暂时不可用：${error.message}`
            );
        }


        await sleep(
            1000
        );
    }


    throw new Error(
        `等待下载页 .exoclick-popunder.juicyads-popunder 超时（${CDP_PAGE_TIMEOUT / 1000} 秒）`
    );
}


/*
 * ============================================================
 * 关闭 CDP Target
 * ============================================================
 */

async function closeCDPTarget(
    targetId,
    ws
) {

    if (
        ws
    ) {

        try {
            ws.close();
        } catch {}
    }


    if (
        !targetId
    ) {

        return;
    }


    try {

        await fetch(
            `${CDP_BASE_URL}/json/close/${targetId}`
        );

    } catch {

        /*
         * 关闭标签页失败不影响下载任务。
         */
    }
}


/*
 * ============================================================
 * 410 -> Hanime download 页面 -> data-url
 * ============================================================
 */

async function refreshHanimeUrl(
    oldUrl
) {

    const videoId =
        extractHanimeVideoId(
            oldUrl
        );


    if (
        !videoId
    ) {

        throw new Error(
            `无法从失败 URL 提取 Hanime 视频 ID：${oldUrl}`
        );
    }


    /*
     * 这里改成 download 页面。
     */
    const downloadUrl =
        `https://hanime1.me/download?v=${videoId}`;


    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        'HTTP 410，开始通过 Chrome CDP 刷新 URL'
    );

    console.log(
        `视频 ID：${videoId}`
    );

    console.log(
        `下载页：${downloadUrl}`
    );

    console.log(
        '========================================'
    );


    let target = null;
    let ws = null;


    try {

        /*
         * 1. 创建新标签页
         */
        target =
            await createCDPTarget();


        /*
         * 2. WebSocket
         */
        ws =
            await connectCDP(
                target.webSocketDebuggerUrl
            );


        /*
         * 3. 直接进入 download 页面
         */
        await navigateByRuntime(
            ws,
            downloadUrl
        );


        /*
         * 4. 获取第一个
         *    .exoclick-popunder.juicyads-popunder
         *
         *    的 data-url
         */
        const newUrl =
            await waitForDownloadPageSource(
                ws
            );


        if (
            !newUrl
        ) {

            throw new Error(
                'CDP 没有获取到 data-url'
            );
        }


        console.log('');

        console.log(
            'CDP 成功获取 data-url：'
        );

        console.log(
            newUrl
        );

        console.log('');


        return newUrl;

    } finally {

        await closeCDPTarget(
            target?.id,
            ws
        );
    }
}


/*
 * ============================================================
 * 刷新失败项目
 *
 * 注意：
 *
 * 原来的：
 *
 *     currentBatchItems
 *
 * 根本不存在。
 *
 * 现在直接传入 batch。
 * ============================================================
 */

async function refreshFailedItem(
    item,
    batch
) {

    const oldUrl =
        item.url;


    console.log('');

    console.log(
        `刷新 410 URL：${oldUrl}`
    );


    const newUrl =
        await refreshHanimeUrl(
            oldUrl
        );


    /*
     * --------------------------------------------------------
     * CDP 返回 blob
     *
     * 保存到 blob-manual.txt
     * 从 download.txt 删除
     * 从当前 Batch 删除
     * 然后停止本次 Batch。
     * --------------------------------------------------------
     */

    if (
        isBlobUrl(
            newUrl
        )
    ) {

        console.log('');

        console.log(
            'CDP 返回的是 blob URL。'
        );

        console.log(
            'aria2 无法下载该 URL。'
        );


        /*
         * 保存人工处理记录。
         */
        appendBlobItems([
            {
                url: newUrl,
                dir: item.dir
            }
        ]);


        /*
         * 从 download.txt 删除原始项目。
         *
         * 注意使用 item.line，
         * 而不是当前已经改变的 URL。
         */
        removeBatchFromDownloadFile([
            item
        ]);


        /*
         * 从当前 Batch 删除。
         */
        const index =
            batch.indexOf(
                item
            );


        if (
            index !== -1
        ) {

            batch.splice(
                index,
                1
            );
        }


        /*
         * 立即保存剩余 Batch。
         *
         * 这样剩下的任务不会丢。
         */
        writeCurrentBatchFile(
            batch
        );


        throw new BlobDiscoveredError(
            `发现 blob URL，已保存到 ${BLOB_FILE}，并已从 ${DOWNLOAD_FILE} 删除。`
        );
    }


    /*
     * --------------------------------------------------------
     * 正常 HTTP/HTTPS URL
     * --------------------------------------------------------
     */

    item.url =
        newUrl;


    /*
     * 这里就是原来报错的位置。
     *
     * 不能写 currentBatchItems，
     * 因为不存在这个变量。
     *
     * 直接写当前 batch。
     */
    writeCurrentBatchFile(
        batch
    );


    console.log('');

    console.log(
        'URL 已更新：'
    );

    console.log(
        `旧：${oldUrl}`
    );

    console.log(
        `新：${newUrl}`
    );

    console.log('');


    return newUrl;
}


/*
 * ============================================================
 * 重新提交任务
 * ============================================================
 */

async function resubmitItem(
    item
) {

    const gid =
        await addUri(
            item.url,
            item.dir
        );


    item._gid =
        gid;


    return gid;
}


/*
 * ============================================================
 * 处理失败任务
 *
 * 410：
 *     download 页面
 *     ->
 *     第一个 .exoclick-popunder.juicyads-popunder
 *     ->
 *     data-url
 *
 * 非 410：
 *     原 URL 重试
 * ============================================================
 */

async function handleFailedTasks(
    batch,
    failed
) {

    const newGids = [];


    for (
        const failure
        of failed
    ) {

        if (
            stopping
        ) {

            throw new Error(
                '脚本正在停止。'
            );
        }


        const item =
            batch.find(
                x =>
                    x._gid ===
                    failure.gid
            );


        if (
            !item
        ) {

            throw new Error(
                `找不到失败 GID 对应的任务：${failure.gid}`
            );
        }


        const task =
            failure.task;


        console.log('');

        console.log(
            '----------------------------------------------'
        );

        console.log(
            `失败 GID：${failure.gid}`
        );

        console.log(
            `错误码：${task.errorCode || ''}`
        );

        console.log(
            `错误信息：${task.errorMessage || ''}`
        );

        console.log(
            `URL：${item.url}`
        );


        /*
         * ====================================================
         * HTTP 410
         * ====================================================
         */

        if (
            isHttp410(task)
        ) {

            console.log('');

            console.log(
                '检测到 HTTP 410。'
            );

            console.log(
                '将通过 CDP 打开 Hanime download 页面获取新 URL。'
            );


            /*
             * 如果这里发现 blob，
             * refreshFailedItem 会：
             *
             * 1. 保存 blob
             * 2. 删除 download.txt 原始行
             * 3. 从 batch 删除
             * 4. 保存剩余 current-batch
             * 5. 抛出 BlobDiscoveredError
             *
             * 因此不会错误地继续移动目录。
             */
            await refreshFailedItem(
                item,
                batch
            );

        } else {

            /*
             * =================================================
             * 非 410
             * =================================================
             */

            console.log('');

            console.log(
                '不是 HTTP 410。'
            );

            console.log(
                '不刷新 URL，继续使用原 URL 重试。'
            );
        }


        /*
         * 重新提交。
         *
         * 注意：
         *
         * 如果是 blob，
         * 上面的 refreshFailedItem 已经抛异常，
         * 不会走到这里。
         */
        const newGid =
            await resubmitItem(
                item
            );


        newGids.push(
            newGid
        );


        console.log(
            `重新提交成功，新 GID：${newGid}`
        );


        if (
            ADD_INTERVAL > 0
        ) {

            await sleep(
                ADD_INTERVAL
            );
        }
    }


    return newGids;
}


/*
 * ============================================================
 * 下载 Batch + 重试
 * ============================================================
 */

async function downloadBatchWithRetry(
    batch,
    initialGids
) {

    let gids =
        [...initialGids];


    let retryRound = 0;

    const MAX_RETRY_ROUNDS = 5;


    while (true) {

        if (
            stopping
        ) {

            throw new Error(
                '脚本正在停止。'
            );
        }


        /*
         * 如果所有任务都因为 blob 等原因被移除，
         * 不再等待 aria2。
         */
        if (
            !gids.length
        ) {

            return;
        }


        const result =
            await waitForBatch(
                gids
            );


        /*
         * 全部成功
         */
        if (
            result.completed
        ) {

            console.log('');

            console.log(
                '本 Batch 所有任务均已成功完成。'
            );

            return;
        }


        retryRound++;


        console.log('');

        console.log(
            `Batch 第 ${retryRound}/${MAX_RETRY_ROUNDS} 次失败重试。`
        );


        if (
            retryRound >
            MAX_RETRY_ROUNDS
        ) {

            const details =
                result.failed
                    .map(
                        failure => {

                            const task =
                                failure.task;


                            return (
                                `GID=${failure.gid}\n` +
                                `错误码=${task.errorCode || ''}\n` +
                                `错误=${task.errorMessage || ''}`
                            );
                        }
                    )
                    .join('\n\n');


            throw new Error(
                `Batch 重试次数已经达到 ${MAX_RETRY_ROUNDS} 次。\n\n` +
                details
            );
        }


        /*
         * 410 会进入 CDP。
         *
         * blob 会在这里直接终止本次 Batch，
         * 但 current-batch 已经保存剩余任务。
         */
        const newGids =
            await handleFailedTasks(
                batch,
                result.failed
            );


        /*
         * 移除旧 GID。
         */
        const failedGids =
            new Set(
                result.failed.map(
                    failure =>
                        failure.gid
                )
            );


        gids =
            gids.filter(
                gid =>
                    !failedGids.has(gid)
            );


        /*
         * 加入新 GID。
         */
        gids.push(
            ...newGids
        );


        console.log('');

        console.log(
            `失败任务已经重新提交，继续等待 ${gids.length} 个任务。`
        );
    }
}


/*
 * ============================================================
 * Batch 目录
 * ============================================================
 */

function getBatchDirectories(
    batch
) {

    const dirs = [];

    const seen =
        new Set();


    for (
        const item
        of batch
    ) {

        if (
            !seen.has(
                item.dir
            )
        ) {

            seen.add(
                item.dir
            );

            dirs.push(
                item.dir
            );
        }
    }


    return dirs;
}


/*
 * ============================================================
 * 文件冲突
 * ============================================================
 */

function getUniqueFilePath(
    filePath
) {

    if (
        !fs.existsSync(
            filePath
        )
    ) {

        return filePath;
    }


    const parsed =
        path.parse(
            filePath
        );


    let index = 1;


    while (true) {

        const candidate =
            path.join(
                parsed.dir,
                `${parsed.name} (${index})${parsed.ext}`
            );


        if (
            !fs.existsSync(
                candidate
            )
        ) {

            return candidate;
        }


        index++;
    }
}


/*
 * ============================================================
 * 合并目录内容
 * ============================================================
 */

function mergeDirectoryContents(
    sourceDir,
    targetDir
) {

    const entries =
        fs.readdirSync(
            sourceDir,
            {
                withFileTypes: true
            }
        );


    for (
        const entry
        of entries
    ) {

        const sourcePath =
            path.join(
                sourceDir,
                entry.name
            );


        const targetPath =
            path.join(
                targetDir,
                entry.name
            );


        /*
         * 子目录
         */
        if (
            entry.isDirectory()
        ) {

            if (
                !fs.existsSync(
                    targetPath
                )
            ) {

                fs.mkdirSync(
                    targetPath,
                    {
                        recursive: true
                    }
                );


                fs.cpSync(
                    sourcePath,
                    targetPath,
                    {
                        recursive: true
                    }
                );


                fs.rmSync(
                    sourcePath,
                    {
                        recursive: true,
                        force: false
                    }
                );


                continue;
            }


            if (
                !directoryExists(
                    targetPath
                )
            ) {

                throw new Error(
                    `无法合并：源是目录，但目标是文件。\n` +
                    `源：${sourcePath}\n` +
                    `目标：${targetPath}`
                );
            }


            mergeDirectoryContents(
                sourcePath,
                targetPath
            );


            const remaining =
                fs.readdirSync(
                    sourcePath
                );


            if (
                remaining.length === 0
            ) {

                fs.rmSync(
                    sourcePath,
                    {
                        recursive: true,
                        force: false
                    }
                );
            }


            continue;
        }


        /*
         * 普通文件
         */
        if (
            entry.isFile()
        ) {

            let finalTargetPath =
                targetPath;


            if (
                fs.existsSync(
                    finalTargetPath
                )
            ) {

                finalTargetPath =
                    getUniqueFilePath(
                        targetPath
                    );


                console.log(
                    `文件重名：${entry.name}`
                );


                console.log(
                    `保存为：${path.basename(finalTargetPath)}`
                );
            }


            fs.copyFileSync(
                sourcePath,
                finalTargetPath
            );


            fs.rmSync(
                sourcePath,
                {
                    force: false
                }
            );


            continue;
        }


        /*
         * 其他类型
         */
        console.warn(
            `跳过无法自动处理的文件类型：${sourcePath}`
        );
    }
}


/*
 * ============================================================
 * 合并目录
 * ============================================================
 */

function mergeDirectory(
    sourceDir,
    targetDir
) {

    if (
        !fs.existsSync(
            sourceDir
        )
    ) {

        throw new Error(
            `源目录不存在：${sourceDir}`
        );
    }


    /*
     * 目标不存在
     */
    if (
        !fs.existsSync(
            targetDir
        )
    ) {

        fs.mkdirSync(
            path.dirname(
                targetDir
            ),
            {
                recursive: true
            }
        );


        fs.cpSync(
            sourceDir,
            targetDir,
            {
                recursive: true,
                errorOnExist: true
            }
        );


        fs.rmSync(
            sourceDir,
            {
                recursive: true,
                force: false
            }
        );


        console.log(
            `目录已移动：${sourceDir} -> ${targetDir}`
        );


        return;
    }


    /*
     * 目标存在
     */
    if (
        !directoryExists(
            targetDir
        )
    ) {

        throw new Error(
            `目标路径不是目录：${targetDir}`
        );
    }


    mergeDirectoryContents(
        sourceDir,
        targetDir
    );


    const remaining =
        fs.readdirSync(
            sourceDir
        );


    if (
        remaining.length === 0
    ) {

        fs.rmSync(
            sourceDir,
            {
                recursive: true,
                force: false
            }
        );


        console.log(
            `目录已合并并删除源目录：${sourceDir}`
        );

    } else {

        console.warn(
            `目录合并完成，但源目录仍有未处理内容：${sourceDir}`
        );
    }
}


/*
 * ============================================================
 * 获取目标目录
 * ============================================================
 */

function getTargetDirectory(
    sourceDir
) {

    const absoluteSource =
        path.resolve(
            sourceDir
        );


    const relative =
        path.relative(
            SOURCE_ROOT,
            absoluteSource
        );


    if (
        relative === '' ||
        relative === '..' ||
        relative.startsWith(
            `..${path.sep}`
        ) ||
        path.isAbsolute(relative)
    ) {

        throw new Error(
            `目录不在 SOURCE_ROOT 内：${sourceDir}`
        );
    }


    return path.join(
        TARGET_ROOT,
        relative
    );
}


/*
 * ============================================================
 * 处理 Batch
 * ============================================================
 */

async function processBatch(
    batch
) {

    console.log('');

    console.log(
        '===================================================='
    );

    console.log(
        '开始新的 Batch'
    );

    console.log(
        `链接数量：${batch.length}`
    );


    const directories =
        getBatchDirectories(
            batch
        );


    console.log(
        `目录数量：${directories.length}`
    );


    console.log('');

    console.log(
        '本 Batch 包含目录：'
    );


    for (
        const dir
        of directories
    ) {

        const count =
            batch.filter(
                item =>
                    item.dir === dir
            ).length;


        console.log(
            `  ${count}\t${dir}`
        );
    }


    console.log(
        '===================================================='
    );


    /*
     * 先保存 Batch
     */
    writeCurrentBatchFile(
        batch
    );


    console.log('');

    console.log(
        `Batch 已保存到：${CURRENT_BATCH_FILE}`
    );


    /*
     * ========================================================
     * 发送 aria2
     * ========================================================
     */

    const gids = [];


    try {

        for (
            const item
            of batch
        ) {

            if (
                stopping
            ) {

                throw new Error(
                    '脚本正在停止。'
                );
            }


            const gid =
                await addUri(
                    item.url,
                    item.dir
                );


            item._gid =
                gid;


            gids.push(
                gid
            );


            console.log(
                `已发送：${item.url}`
            );


            console.log(
                `  目录：${item.dir}`
            );


            console.log(
                `  GID：${gid}`
            );


            if (
                ADD_INTERVAL > 0
            ) {

                await sleep(
                    ADD_INTERVAL
                );
            }
        }

    } catch (error) {

        console.error('');

        console.error(
            '提交 aria2 任务时发生错误。'
        );

        console.error(
            error.message
        );

        console.error('');

        console.error(
            `current-batch.txt 已保留：${CURRENT_BATCH_FILE}`
        );


        throw error;
    }


    /*
     * 下载
     */
    console.log('');

    console.log(
        `已完整发送 ${gids.length} 个任务。`
    );

    console.log(
        '等待 aria2 下载……'
    );


    await downloadBatchWithRetry(
        batch,
        gids
    );


    /*
     * 所有下载成功
     */
    console.log('');

    console.log(
        'aria2 已确认整个 Batch 全部完成。'
    );


    /*
     * 合并目录
     */
    console.log('');

    console.log(
        '开始合并目录……'
    );


    for (
        const sourceDir
        of directories
    ) {

        if (
            stopping
        ) {

            throw new Error(
                '脚本正在停止。'
            );
        }


        const targetDir =
            getTargetDirectory(
                sourceDir
            );


        console.log('');

        console.log(
            `源目录：${sourceDir}`
        );

        console.log(
            `目标目录：${targetDir}`
        );


        mergeDirectory(
            sourceDir,
            targetDir
        );
    }


    /*
     * 所有目录成功
     */
    console.log('');

    console.log(
        '本 Batch 所有目录均已成功处理。'
    );


    /*
     * 删除 download.txt 原始行
     */
    removeBatchFromDownloadFile(
        batch
    );


    console.log(
        `已从 ${DOWNLOAD_FILE} 删除本 Batch。`
    );


    /*
     * 最后清空 current-batch
     */
    clearCurrentBatchFile();


    console.log(
        `已清空 ${CURRENT_BATCH_FILE}`
    );


    console.log('');

    console.log(
        'Batch 完成。'
    );
}


/*
 * ============================================================
 * aria2 测试
 * ============================================================
 */

async function testAria2() {

    try {

        const version =
            await rpc(
                'aria2.getVersion'
            );


        console.log(
            `aria2 已连接，版本：${version.version}`
        );

    } catch (error) {

        throw new Error(
            `无法连接 aria2：${error.message}`
        );
    }
}


/*
 * ============================================================
 * CDP 测试
 * ============================================================
 */

async function testCDP() {

    console.log(
        '测试 Chrome CDP...'
    );


    let target = null;
    let ws = null;


    try {

        target =
            await createCDPTarget();


        ws =
            await connectCDP(
                target.webSocketDebuggerUrl
            );


        const result =
            await cdpEvaluate(
                ws,
                `location.href`
            );


        console.log(
            `CDP 测试成功，当前页面：${result}`
        );


        return true;

    } finally {

        await closeCDPTarget(
            target?.id,
            ws
        );
    }
}


/*
 * ============================================================
 * 主程序
 * ============================================================
 */

async function main() {

    console.log(
        '=============================================='
    );

    console.log(
        'aria2 批量目录下载器'
    );

    console.log(
        '=============================================='
    );


    /*
     * TOKEN
     */
    if (
        !RPC_TOKEN
    ) {

        throw new Error(
            '没有检测到 TOKEN 环境变量。\n' +
            'PowerShell 示例：\n' +
            '$env:TOKEN="你的TOKEN"'
        );
    }


    /*
     * aria2
     */
    await testAria2();


    /*
     * CDP
     */
    await testCDP();


    /*
     * ========================================================
     * 恢复 current-batch
     * ========================================================
     */

    if (
        hasPendingCurrentBatch()
    ) {

        console.log('');

        console.log(
            '===================================================='
        );

        console.log(
            '发现未完成的 current-batch.txt'
        );

        console.log(
            '准备继续处理上一次 Batch。'
        );

        console.log(
            '不会要求手动清空 current-batch.txt。'
        );

        console.log(
            '===================================================='
        );


        const currentItems =
            readCurrentBatchFile();


        if (
            !currentItems.length
        ) {

            clearCurrentBatchFile();

        } else {

            /*
             * 重新读取 download.txt
             */
            const downloadItems =
                readDownloadFile();


            /*
             * 恢复原始 Batch
             */
            const batch =
                restoreBatchFromCurrent(
                    currentItems,
                    downloadItems
                );


            console.log('');

            console.log(
                `恢复 ${batch.length} 个未完成任务。`
            );


            /*
             * 重新提交 aria2
             */
            const gids = [];


            for (
                const item
                of batch
            ) {

                if (
                    stopping
                ) {

                    throw new Error(
                        '脚本正在停止。'
                    );
                }


                const gid =
                    await addUri(
                        item.url,
                        item.dir
                    );


                item._gid =
                    gid;


                gids.push(
                    gid
                );


                console.log(
                    `恢复任务：${item.url}`
                );


                console.log(
                    `  GID：${gid}`
                );


                if (
                    ADD_INTERVAL > 0
                ) {

                    await sleep(
                        ADD_INTERVAL
                    );
                }
            }


            /*
             * 下载
             */
            await downloadBatchWithRetry(
                batch,
                gids
            );


            /*
             * 下载成功以后再移动目录
             */
            const directories =
                getBatchDirectories(
                    batch
                );


            for (
                const sourceDir
                of directories
            ) {

                if (
                    stopping
                ) {

                    throw new Error(
                        '脚本正在停止。'
                    );
                }


                const targetDir =
                    getTargetDirectory(
                        sourceDir
                    );


                console.log('');

                console.log(
                    `源目录：${sourceDir}`
                );

                console.log(
                    `目标目录：${targetDir}`
                );


                mergeDirectory(
                    sourceDir,
                    targetDir
                );
            }


            /*
             * 删除 download.txt 原始行
             */
            removeBatchFromDownloadFile(
                batch
            );


            console.log(
                `已从 ${DOWNLOAD_FILE} 删除恢复 Batch。`
            );


            /*
             * 清空 current
             */
            clearCurrentBatchFile();


            console.log(
                `已清空 ${CURRENT_BATCH_FILE}`
            );
        }
    }


    /*
     * ========================================================
     * 正常动态处理 download.txt
     * ========================================================
     */

    while (true) {

        if (
            stopping
        ) {

            return;
        }


        /*
         * 每一个 Batch 都重新读取。
         */
        const items =
            readDownloadFile();


        /*
         * 没有任务
         */
        if (
            !items.length
        ) {

            console.log('');

            console.log(
                'download.txt 当前没有待下载链接。'
            );

            console.log(
                '全部任务处理完成。'
            );

            return;
        }


        /*
         * ====================================================
         * 先处理已经存在的 blob
         * ====================================================
         */

        const blobItems =
            items.filter(
                item =>
                    isBlobUrl(
                        item.url
                    )
            );


        if (
            blobItems.length
        ) {

            console.log('');

            console.log(
                `发现 ${blobItems.length} 个 blob 链接。`
            );


            /*
             * 保存人工处理文件
             */
            appendBlobItems(
                blobItems
            );


            /*
             * 从 download.txt 删除
             */
            removeBatchFromDownloadFile(
                blobItems
            );


            console.log(
                'blob 链接已经保存并从 download.txt 删除。'
            );


            continue;
        }


        /*
         * ====================================================
         * 构造 Batch
         * ====================================================
         */

        const batch =
            buildNextBatch(
                items
            );


        if (
            !batch.length
        ) {

            console.log(
                '没有可以处理的 Batch。'
            );

            return;
        }


        /*
         * ====================================================
         * 正常处理
         * ====================================================
         */

        await processBatch(
            batch
        );


        console.log('');

        console.log(
            '重新读取动态 download.txt……'
        );
    }
}


/*
 * ============================================================
 * Ctrl+C
 * ============================================================
 */

process.on(
    'SIGINT',
    () => {

        if (
            stopping
        ) {

            return;
        }


        stopping = true;


        console.log('');
        console.log('');


        console.log(
            '=============================================='
        );

        console.log(
            '收到 Ctrl+C'
        );

        console.log(
            '=============================================='
        );


        console.log(
            '脚本将停止。'
        );


        console.log(
            '不会取消 aria2 中的下载任务。'
        );


        console.log(
            '不会移动当前目录。'
        );


        console.log(
            '不会修改 download.txt。'
        );


        console.log(
            `current-batch.txt 保留：${CURRENT_BATCH_FILE}`
        );


        console.log('');


        console.log(
            '下次启动脚本时会自动从 current-batch.txt 继续。'
        );


        process.exit(130);
    }
);


/*
 * ============================================================
 * 启动
 * ============================================================
 */

main().catch(
    error => {

        console.error('');

        console.error(
            '=============================================='
        );

        console.error(
            '程序发生错误'
        );

        console.error(
            '=============================================='
        );

        console.error('');


        /*
         * blob 是预期的人工处理情况，
         * 不需要打印成普通错误堆栈。
         */
        if (
            error instanceof BlobDiscoveredError
        ) {

            console.error(
                error.message
            );

            console.error('');

            console.error(
                `blob-manual.txt：${BLOB_FILE}`
            );

            console.error(
                `剩余 current-batch.txt：${CURRENT_BATCH_FILE}`
            );

            console.error('');

            console.error(
                '本次运行已停止。手动处理 blob 后重新运行即可。'
            );

            process.exit(2);
        }


        console.error(
            error
        );

        console.error('');


        console.error(
            `current-batch.txt：${CURRENT_BATCH_FILE}`
        );

        console.error('');


        console.error(
            '如果 Batch 没有完成，current-batch.txt 会保留。'
        );


        console.error(
            '下次启动脚本时会尝试继续这个 Batch。'
        );


        process.exit(1);
    }
);