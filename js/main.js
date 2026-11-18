const CDP = require("chrome-remote-interface");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://hanime1.me";
const DB_FILE = path.resolve("videos.db");
const DOWNLOAD_FILE = path.resolve("download.txt");

const PAGE = Number(process.argv[2] || 1);

const db = new Database(DB_FILE);

db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY
    )
`);

const insertId = db.prepare(`
    INSERT OR IGNORE INTO videos (id)
    VALUES (?)
`);

const hasId = db.prepare(`
    SELECT 1 FROM videos WHERE id = ?
`);

const queue = [];
const queued = new Set();
const expanded = new Set();


function getVideoId(href) {
    try {
        const url = new URL(href, BASE_URL);

        if (url.pathname !== "/watch") {
            return null;
        }

        const id = Number(url.searchParams.get("v"));

        if (!Number.isSafeInteger(id)) {
            return null;
        }

        return id;
    } catch {
        return null;
    }
}


function enqueue(id) {
    if (!Number.isSafeInteger(id)) {
        return;
    }

    if (queued.has(id)) {
        return;
    }

    if (hasId.get(id)) {
        console.log(`[SKIP] ${id}`);
        return;
    }

    queued.add(id);
    queue.push(id);

    console.log(`[QUEUE] ${id}`);
}


async function waitForSelector(Runtime, selector, timeout = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const result = await Runtime.evaluate({
            expression: `
                !!document.querySelector(${JSON.stringify(selector)})
            `,
            returnByValue: true
        });

        if (result.result.value) {
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return false;
}


async function navigate(Page, Runtime, url) {
    await Page.navigate({ url });

    await waitForSelector(Runtime, "body", 10000);
}


async function loadSearchPage(Page, Runtime) {
    let url = `${BASE_URL}/search?genre=%E6%B3%A1%E9%BA%B5%E7%95%AA`;

    if (PAGE > 1) {
        url += `&page=${PAGE}`;
    }

    console.log(`\n搜索页: ${url}`);

    await navigate(Page, Runtime, url);

    const ok = await waitForSelector(
        Runtime,
        ".home-rows-videos-wrapper",
        10000
    );

    if (!ok) {
        throw new Error("搜索结果容器加载失败");
    }

    const result = await Runtime.evaluate({
        expression: `
            (() => {
                const wrapper = document.querySelector(
                    ".home-rows-videos-wrapper"
                );

                if (!wrapper) {
                    return [];
                }

                return [...wrapper.children]
                    .slice(1)
                    .filter(el => el.tagName === "A")
                    .map(el => el.href)
                    .filter(Boolean);
            })()
        `,
        returnByValue: true
    });

    const links = result.result.value || [];

    console.log(`找到 ${links.length} 个链接`);

    for (const href of links) {
        const id = getVideoId(href);

        if (id !== null) {
            enqueue(id);
        }
    }
}


async function getTitle(Runtime) {
    const result = await Runtime.evaluate({
        expression: `
            (() => {
                const elements = document.querySelectorAll(
                    ".video-description-panel > div"
                );

                return elements[2]?.innerText?.trim() || null;
            })()
        `,
        returnByValue: true
    });

    return result.result.value;
}


function getSeriesName(title) {
    const index = title.lastIndexOf(" ");

    if (index === -1) {
        return title;
    }

    return title.slice(0, index).trim();
}


function sanitizeFolderName(name) {
    return name
        .replace(/[<>:"/\\\\|?*]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim() || "Unknown";
}


function getSeriesDirectory(title) {
    const series = getSeriesName(title);
    const safeName = sanitizeFolderName(series);

    // 使用当前脚本工作目录的绝对路径
    const dir = path.resolve(safeName);

    fs.mkdirSync(dir, { recursive: true });

    return dir;
}


async function getVideoSrc(Runtime) {
    const result = await Runtime.evaluate({
        expression: `
            (() => {
                const player = document.querySelector("#player");

                if (!player) {
                    return null;
                }

                if (player.src) {
                    return player.src;
                }

                const sources = [...player.querySelectorAll("source")]
                    .map(el => ({
                        src: el.src,
                        size: Number(el.getAttribute("size")) || 0
                    }))
                    .filter(x => x.src);

                sources.sort((a, b) => b.size - a.size);

                return sources[0]?.src || null;
            })()
        `,
        returnByValue: true
    });

    return result.result.value;
}


function appendDownload(url, dir) {
    fs.appendFileSync(
        DOWNLOAD_FILE,
        `${url}\t${dir}\n`,
        "utf8"
    );
}


async function getPlaylistIds(Runtime) {
    const result = await Runtime.evaluate({
        expression: `
            (() => {
                const container = document.querySelector("#playlist-scroll");

                if (!container) {
                    return [];
                }

                return [...container.children]
                    .map(el => el.dataset.href)
                    .filter(Boolean);
            })()
        `,
        returnByValue: true
    });

    return (result.result.value || [])
        .map(getVideoId)
        .filter(id => id !== null);
}


async function processVideo(Page, Runtime, id) {
    console.log(`\n[VIDEO] ${id}`);

    const url = `${BASE_URL}/watch?v=${id}`;

    await navigate(Page, Runtime, url);

    // 进入实际处理后才写入 SQLite
    insertId.run(id);

    const title = await getTitle(Runtime);

    if (!title) {
        console.log(`[NO TITLE] ${id}`);
    } else {
        console.log(`[TITLE] ${title}`);
    }

    if (title) {
        const dir = getSeriesDirectory(title);

        console.log(`[DIR] ${dir}`);

        const src = await getVideoSrc(Runtime);

        if (src) {
            console.log(`[SRC] ${src}`);
            appendDownload(src, dir);
            console.log(`[DOWNLOAD QUEUE] ${id}`);
        } else {
            console.log(`[NO VIDEO SRC] ${id}`);
        }
    }

    if (!expanded.has(id)) {
        expanded.add(id);

        const playlistIds = await getPlaylistIds(Runtime);

        console.log(`[PLAYLIST] ${playlistIds.length} 个`);

        for (const childId of playlistIds) {
            enqueue(childId);
        }
    }
}


async function main() {
    let target = null;
    let client = null;

    try {
        /*
         * 创建 crawler 专用 Tab。
         * 不使用当前已有的 Tab。
         */
        target = await CDP.New({
            port: 9222,
            url: "about:blank"
        });

        client = await CDP({
            port: 9222,
            target
        });

        const { Page, Runtime } = client;

        await Page.enable();
        await Runtime.enable();

        console.log("已创建 crawler 专用 Tab");

        await loadSearchPage(Page, Runtime);

        console.log(`\n初始 Queue: ${queue.length}`);

        while (queue.length > 0) {
            const id = queue.shift();

            try {
                await processVideo(Page, Runtime, id);
            } catch (err) {
                console.error(`[ERROR] ${id}:`, err.message);
            }
        }

        console.log("\n全部任务处理完成");

    } finally {
        if (client) {
            await client.close().catch(() => {});
        }

        if (target) {
            await CDP.Close({
                port: 9222,
                id: target.id
            }).catch(() => {});
        }

        db.close();
    }
}


main().catch(err => {
    console.error(err);
    process.exit(1);
});