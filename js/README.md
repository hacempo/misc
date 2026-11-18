# JavaScript Utilities

本目录按“单一职责入口 + 可复用模块”组织。入口脚本负责具体任务，公共能力集中在 `lib/`。

## 入口脚本

| 文件 | 职责 | 输入 / 输出 |
|---|---|---|
| `main.js` | Hanime 分类爬虫：提取视频 ID、标题、播放源，并遍历播放列表；通过 SQLite 去重。 | 输出：`download.txt`；数据库：`videos.db` |
| `get-download-links.js` | 按 `task.txt` 中的关键词搜索 Hanime，提取下载页 `data-url`。 | 输入：`task.txt`；输出：`download.txt`（URL + TAB + 搜索词/目录标签） |
| `get-latest.js` | 从一组页面 URL 中提取标题与下载 URL。 | 输入：`task.txt`；输出：`result.txt`（标题 + 空格 + URL） |
| `javdb.js` | 搜索 JAVDB，筛选评论并提取 ed2k/magnet 链接。 | 输入：`js/task.txt`；输出：`js/result.txt`（链接 + TAB + 搜索词） |
| `init-db.js` | 扫描本地 MP4 文件名并把数字 ID 写入 SQLite。 | 输入：`G:\h`；数据库：`videos.db` |
| `sort-downloads.js` | 按每个目录的任务数量升序重排下载队列，异常行保留。 | 输入/输出：`download.txt` |
| `send-downloads.js` | 按 aria2 当前活动/等待任务数补足下载并发。 | 输入/更新：`download.txt` |
| `send-latest.js` | 将 `result.txt` 中的标题/URL 任务提交给 aria2，并按标题归档。 | 输入：`result.txt`；下载根目录：`G:\h\h` |
| `download-batch.js` | 批量下载入口：调度批次、重试、刷新 HTTP 410 链接、记录 blob，并归档已完成目录。 | 输入：`download.txt`；状态：`current-batch.txt`；人工列表：`blob-manual.txt` |

## 可复用模块

| 模块 | 职责 |
|---|---|
| `lib/browser.js` | Puppeteer 连接、创建/关闭页面和断开浏览器连接。 |
| `lib/hanime.js` | Hanime URL、视频 ID、搜索结果、标题、播放源、播放列表和下载页提取。 |
| `lib/javdb-scraper.js` | JAVDB 评论 iframe、评论优先级和链接提取。 |
| `lib/aria2-client.js` | aria2 JSON-RPC、任务提交、状态查询和并发统计。 |
| `lib/queue.js` | 队列解析、原子写入、按原始行删除和批次状态文件。 |
| `lib/video-db.js` | SQLite 视频 ID 数据库及去重接口。 |
| `lib/file-manager.js` | 文件夹名清理、目录映射、冲突改名和目录合并。 |
| `lib/config.js` | 统一管理文件路径、数据库路径和下载根目录。 |
| `lib/batch-downloader.js` | 批次创建、断点恢复、失败重试和批量下载流程。 |

## 环境

- 浏览器自动化统一使用 `puppeteer-core` 连接已启动的 Chrome。
- 建议使用 Node.js 22 或更新版本。
- 依赖：`npm install puppeteer-core better-sqlite3`。
- Chrome 远程调试地址默认为 `http://127.0.0.1:9222`，可用 `CHROME_CDP_URL` 修改。
- aria2 RPC 默认为 `http://127.0.0.1:29000/jsonrpc`，可用 `ARIA2_RPC_URL` 修改。
- aria2 密钥统一从环境变量 `TOKEN` 读取，禁止写入源码。

PowerShell 示例：

```powershell
$env:TOKEN = "你的 aria2 RPC 密钥"
node js/send-downloads.js
# 或者运行批量下载管理器
node js/download-batch.js
```

### 可配置路径

以下环境变量可以覆盖默认路径：

- `TASK_FILE`、`DOWNLOAD_FILE`、`RESULT_FILE`
- `CURRENT_BATCH_FILE`、`BLOB_FILE`、`VIDEO_DB_FILE`
- `DOWNLOAD_SOURCE_ROOT`（默认 `D:\h`）
- `DOWNLOAD_TARGET_ROOT`（默认 `G:\h`）
- `VIDEO_LIBRARY_ROOT`（默认 `G:\h`）

## 队列格式

- `download.txt`：每行 `URL<TAB>目录`。批量下载器要求目录位于 `DOWNLOAD_SOURCE_ROOT` 下，下载完成后映射到 `DOWNLOAD_TARGET_ROOT`。
- `get-download-links.js` 会把搜索关键词清理为目录名，并在 `DOWNLOAD_SOURCE_ROOT` 下创建目录，再将该绝对路径写入 TAB 后面。
- `get-latest.js`：每行 `标题 URL`，由 `send-latest.js` 读取。
- `javdb.js`：每行 `链接<TAB>搜索词`，保存在 `js/result.txt`。

## 安全提醒

aria2 RPC 密钥曾经出现在公开仓库历史中。当前脚本已改为读取环境变量，但这不会撤销已经泄露的旧密钥。请在 aria2 配置中轮换/撤销旧密钥。