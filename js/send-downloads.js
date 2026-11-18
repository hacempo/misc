const fs = require("fs");

const DOWNLOAD_FILE = "download.txt";

const ARIA2_RPC_URL = "http://127.0.0.1:29000/jsonrpc";

// 填入你之前使用的 TOKEN
const ARIA2_RPC_TOKEN = "kH3sBtvan7C5Bk6C";

const MAX_TASKS = 5;

// 检查 aria2 状态的间隔，单位：毫秒
const CHECK_INTERVAL = 10000;


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * 给所有 RPC 请求统一添加 token
 */
function rpcParams(params = []) {
    if (ARIA2_RPC_TOKEN) {
        return [`token:${ARIA2_RPC_TOKEN}`, ...params];
    }

    return params;
}


/**
 * 读取 download.txt
 *
 * 格式：
 *
 * URL<TAB>完整目录
 *
 * 例如：
 *
 * https://example.com/a.mp4    D:\h\系列A
 */
function loadTasks() {
    if (!fs.existsSync(DOWNLOAD_FILE)) {
        return [];
    }

    const text = fs.readFileSync(DOWNLOAD_FILE, "utf8");

    return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const tab = line.indexOf("\t");

            // 正式格式必须使用 TAB
            if (tab === -1) {
                console.log(`[WARN] 忽略格式错误的行: ${line}`);
                return null;
            }

            return {
                url: line.slice(0, tab).trim(),
                dir: line.slice(tab + 1).trim()
            };
        })
        .filter(task => task && task.url && task.dir);
}


/**
 * 调用 aria2 JSON-RPC
 */
async function aria2Call(method, params = []) {
    const body = {
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params: rpcParams(params)
    };

    const response = await fetch(ARIA2_RPC_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}\n${text}`);
    }

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`RPC 返回的不是 JSON:\n${text}`);
    }

    if (data.error) {
        throw new Error(
            `aria2 error ${data.error.code}: ${data.error.message}`
        );
    }

    return data.result;
}


/**
 * 获取 aria2 当前任务数量
 *
 * active  = 正在下载
 * waiting = 等待下载
 */
async function getAria2TaskCount() {
    const active = await aria2Call("aria2.tellActive", [
        ["gid"]
    ]);

    const waiting = await aria2Call("aria2.tellWaiting", [
        0,
        1000,
        ["gid"]
    ]);

    return {
        active: active.length,
        waiting: waiting.length,
        total: active.length + waiting.length
    };
}


/**
 * 向 aria2 添加一个下载任务
 */
async function sendToAria2(task) {
    return await aria2Call("aria2.addUri", [
        [task.url],
        {
            // 使用 download.txt 中保存的完整绝对路径
            dir: task.dir
        }
    ]);
}


/**
 * 从 download.txt 删除最前面的 count 个任务
 *
 * 使用临时文件 + rename，避免直接覆盖原文件。
 */
function removeFirstTasks(count) {
    const text = fs.readFileSync(DOWNLOAD_FILE, "utf8");

    const lines = text
        .split(/\r?\n/)
        .filter(line => line.trim() !== "");

    const remaining = lines.slice(count);

    const tmp = `${DOWNLOAD_FILE}.tmp`;

    fs.writeFileSync(
        tmp,
        remaining.length
            ? remaining.join("\n") + "\n"
            : "",
        "utf8"
    );

    fs.renameSync(tmp, DOWNLOAD_FILE);
}


/**
 * 根据 aria2 当前空位发送任务
 *
 * 例如：
 *
 * aria2 当前有 3 个任务
 * MAX_TASKS = 5
 *
 * 那么只发送 2 个。
 */
async function sendAvailableTasks() {
    const tasks = loadTasks();

    if (tasks.length === 0) {
        return 0;
    }

    const state = await getAria2TaskCount();

    const available = MAX_TASKS - state.total;

    console.log(
        `\naria2: active=${state.active}, ` +
        `waiting=${state.waiting}, ` +
        `download.txt=${tasks.length}`
    );

    if (available <= 0) {
        return 0;
    }

    const batch = tasks.slice(0, available);

    console.log(`发送 ${batch.length} 个`);

    let success = 0;

    for (const task of batch) {
        try {
            const gid = await sendToAria2(task);

            console.log(`[OK] ${task.url}`);
            console.log(`     DIR: ${task.dir}`);
            console.log(`     GID: ${gid}`);

            success++;

        } catch (err) {
            console.log(`[ERROR] ${task.url}`);
            console.log(err.message);

            // 当前任务发送失败。
            // 后面的任务不继续发送，避免删除顺序出问题。
            break;
        }
    }

    if (success > 0) {
        removeFirstTasks(success);

        console.log(
            `已从 download.txt 删除 ${success} 个任务`
        );
    }

    return success;
}


/**
 * 主循环
 */
async function main() {
    console.log("RayBurst sender 启动");
    console.log(`目标并发任务数: ${MAX_TASKS}`);

    while (true) {
        const tasks = loadTasks();

        // download.txt 已经没有任务
        if (tasks.length === 0) {
            console.log("\ndownload.txt 已清空");
            break;
        }

        try {
            const sent = await sendAvailableTasks();

            /*
             * sent === 0 有两种可能：
             *
             * 1. aria2 当前已经有 MAX_TASKS 个任务
             * 2. 发生了其他情况
             *
             * 等待后再次检查。
             */
            if (sent === 0) {
                await sleep(CHECK_INTERVAL);
            }

        } catch (err) {
            console.log("\n[RPC ERROR]");
            console.log(err.message);

            console.log(
                `等待 ${CHECK_INTERVAL / 1000} 秒后重试...`
            );

            await sleep(CHECK_INTERVAL);
        }
    }

    console.log("\n发送程序结束");
}


main().catch(err => {
    console.error(err);
    process.exit(1);
});