# JavaScript Utilities

Hanime 流程按页面类型拆分：搜索页只提取视频页链接，视频页只提取播放列表链接，下载页只提取标题和真实下载地址，下载器只负责目录和 aria2。

## Hanime 脚本

| 脚本 | 职责 | 默认输入 / 输出 |
|---|---|---|
| get-video-links.js | 从指定搜索页提取当页所有视频页链接。支持 genre、query 等搜索参数；不带 page 即第 1 页。 | 参数：搜索页 URL；输出：video-links.txt |
| get-download-links.js | 从 task.txt 读取关键词，构造 Hanime 搜索页并提取视频页链接。搜索页面采集复用同一模块。 | 输入：task.txt；输出：video-links.txt |
| filter-video-links.js | 用 SQLite 数据库过滤已经入库的视频 ID。 | 输入：video-links.txt；输出：filtered-video-links.txt |
| get-playlist-links.js | 打开视频页，提取播放列表中的其他视频页链接。 | 输入：filtered-video-links.txt；输出：playlist-links.txt |
| get-latest.js | 把视频页链接转换为 /download?v=ID，提取唯一 h3 标题和下载地址。 | 输入：filtered-video-links.txt；追加输出：download.txt |
| download.js | 创建标题目录并把下载地址交给 aria2；失败任务的原视频页链接写入 retry.txt。 | 输入：download.txt；状态：downloading.txt；失败：retry.txt |

### 推荐流程

~~~powershell
# 方式一：直接采集某个搜索页（不带 page 参数时就是第 1 页）
node js/get-video-links.js "https://hanime1.me/search?genre=%E8%A3%8F%E7%95%AA&page=2"

# 方式二：按 task.txt 中的关键词搜索；两种搜索方式输出格式相同
node js/get-download-links.js

# 过滤数据库中已有的视频 ID
node js/filter-video-links.js

# 下载页提取标题和下载地址，追加进统一任务文件
node js/get-latest.js

# 下载；失败的视频页链接会写入 retry.txt
node js/download.js

# 失败后重新获取最新下载地址，再交给下载器
node js/get-latest.js retry.txt
node js/download.js
~~~

播放列表是独立的扩展来源，可以这样接入相同的下载流程：

~~~powershell
node js/get-playlist-links.js
node js/filter-video-links.js playlist-links.txt filtered-playlist-links.txt
node js/get-latest.js filtered-playlist-links.txt
node js/download.js
~~~

也可以给脚本传入自定义文件：

~~~powershell
node js/filter-video-links.js input.txt output.txt
node js/get-playlist-links.js input.txt output.txt
node js/get-latest.js input.txt output.txt
~~~

## 文本格式

- 搜索、过滤、播放列表文件：每行一个 https://hanime1.me/watch?v=视频ID。
- download.txt：每行 标题<TAB>下载URL<TAB>原视频页URL。第三列用于下载失败时恢复原视频 ID，并生成可重新抓取的 watch 链接。
- downloading.txt：下载器内部状态文件，保存 aria2 GID 和对应任务；不要手动编辑。
- retry.txt：每行一个失败任务的 watch 链接，可直接作为 get-latest.js 的输入。
- JavDB 保持独立：javdb.js 读取 js/task.txt，结果写入 js/result.txt。

## 其他脚本

- init-db.js：扫描本地 MP4 文件名，把文件名开头的数字 ID 写入 videos.db。
- javdb.js、lib/javdb-scraper.js：JavDB 搜索和评论链接提取，和 Hanime 下载流程分离。

## 环境

- 浏览器自动化使用 puppeteer-core，连接已经启动的 Chrome。
- 建议 Node.js 22 或更新版本。
- 依赖：npm install puppeteer-core better-sqlite3。
- Chrome 远程调试地址默认 http://127.0.0.1:9222，可用 CHROME_CDP_URL 修改。
- aria2 RPC 默认 http://127.0.0.1:29000/jsonrpc，可用 ARIA2_RPC_URL 修改。
- aria2 密钥从环境变量 TOKEN 读取，不要写入源码。

PowerShell 示例：

~~~powershell
$env:TOKEN = "你的 aria2 RPC 密钥"
node js/download.js
~~~

### 可配置路径

- TASK_FILE（默认 task.txt）
- VIDEO_LINKS_FILE（默认 video-links.txt）
- FILTERED_LINKS_FILE（默认 filtered-video-links.txt）
- PLAYLIST_LINKS_FILE（默认 playlist-links.txt）
- DOWNLOAD_FILE（默认 download.txt）
- RUNNING_FILE（默认 downloading.txt）
- RETRY_FILE（默认 retry.txt）
- VIDEO_DB_FILE（默认 videos.db）
- DOWNLOAD_ROOT（默认 G:\h；兼容旧变量 DOWNLOAD_TARGET_ROOT）
- VIDEO_LIBRARY_ROOT（默认 G:\h）

## 安全提醒

aria2 RPC 密钥曾经出现在公开仓库历史中。当前脚本从环境变量读取密钥，但这不会撤销已经泄露的旧密钥。请在 aria2 配置中轮换/撤销它。
