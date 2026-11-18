# JavaScript Utilities

Hanime 流程按页面职责拆分。每个 TXT 文件存放一种页面类型的 URL，一行一个。

## 工作流

~~~powershell
# 搜索页 URL -> 视频页 URL
node js/get-search.js

# 数据库过滤，原地更新 watch.txt
node js/filter-id.js

# 打开每个视频页，展开并合并播放列表链接到 watch.txt
node js/get-watch.js

# 过滤刚展开的列表视频 ID
node js/filter-id.js

# watch URL -> download URL（只修改地址，不访问浏览器）
node js/to-download.js

# 打开 download.txt，提取标题、真实下载地址和 download 页地址
node js/get-download.js

# 创建标题目录、提交 aria2、跟踪任务状态
# 失败任务的 download 页 URL 会回写到 download.txt
node js/send-aria2.js

# 失败后直接重新打开 download 页刷新下载地址
node js/get-download.js
node js/send-aria2.js
~~~

## TXT 文件含义

| 文件 | 每行内容 | 用途 |
|---|---|---|
| search.txt | Hanime 搜索页 URL，路径为 /search，query 参数不限 | get-search.js 输入 |
| watch.txt | Hanime 视频页 URL，路径为 /watch，包含 v 参数 | get-search.js 输出；filter-id.js 和 get-watch.js 原地修改 |
| download.txt | Hanime 下载页 URL，路径为 /download，包含 v 参数 | to-download.js 输出；get-download.js 输入；下载失败时回写 |
| send.txt | 标题<TAB>真实下载链接<TAB>download 页 URL | get-download.js 输出；send-aria2.js 输入 |
| sending.txt | aria2 GID<TAB>标题<TAB>真实下载链接<TAB>download 页 URL | 下载器断点状态，不要手动编辑 |
| videos.db | 已完成下载或本地视频的 ID 数据库 | filter-id.js 查询；下载成功后更新 |

可以通过参数指定输入和输出文件：

~~~powershell
node js/get-search.js another-search.txt another-watch.txt
node js/filter-id.js another-watch.txt
node js/get-watch.js another-watch.txt
node js/to-download.js another-watch.txt another-download.txt
node js/get-download.js another-download.txt another-send.txt
~~~

## 自动备份

所有脚本在覆盖、修改或追加 TXT 文件之前，都会先备份原文件（文件存在时）。备份保存在同一目录，文件名带本地时间戳，例如：

~~~text
watch.20261118-202647-123.txt
~~~

备份通过重命名原文件完成，不会覆盖旧备份。SQLite 数据库不属于 TXT 备份流程。

## 其他脚本

- init-db.js：扫描本地 MP4 文件名，把开头的数字 ID 写入 videos.db。
- javdb.js、lib/javdb-scraper.js：独立 JAVDB 流程，保留原有输入输出。

## 环境

- 浏览器自动化使用 puppeteer-core，连接已经启动的 Chrome。
- 建议 Node.js 22 或更新版本。
- 依赖：npm install puppeteer-core better-sqlite3。
- Chrome 远程调试地址默认 http://127.0.0.1:9222，可用 CHROME_CDP_URL 修改。
- aria2 RPC 默认 http://127.0.0.1:29000/jsonrpc，可用 ARIA2_RPC_URL 修改。
- aria2 密钥从环境变量 TOKEN 读取，不要写入源码。
- 下载目录默认 G:\h，可用 DOWNLOAD_ROOT 修改；兼容 DOWNLOAD_TARGET_ROOT。

PowerShell 示例：

~~~powershell
$env:TOKEN = "你的 aria2 RPC 密钥"
node js/send-aria2.js
~~~

### 可配置路径

- SEARCH_FILE（默认 search.txt）
- WATCH_FILE（默认 watch.txt）
- DOWNLOAD_FILE（默认 download.txt）
- SEND_FILE（默认 send.txt）
- SENDING_FILE（默认 sending.txt）
- VIDEO_DB_FILE（默认 videos.db）
- DOWNLOAD_ROOT（默认 G:\h）
- VIDEO_LIBRARY_ROOT（默认 G:\h）

## 安全提醒

aria2 RPC 密钥曾经出现在公开仓库历史中。当前脚本从环境变量读取密钥，但这不会撤销已经泄露的旧密钥。请在 aria2 配置中轮换或撤销它。
