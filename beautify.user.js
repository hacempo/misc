// ==UserScript==
// @name         beautify
// @namespace    http://tampermonkey.net/
// @version      8.0.2
// @description  独立控制指定网站的页面美化与元素屏蔽
// @match        *://tieba.baidu.com/*
// @match        *://*.tieba.baidu.com/*
// @match        *://115.com/*
// @match        *://*.115.com/*
// @match        *://javdb.com/*
// @match        *://*.javdb.com/*
// @match        *://115vod.com/*
// @match        *://*.115vod.com/*
// @match        *://ngabbs.com/*
// @match        *://*.ngabbs.com/*
// @match        *://yun.123pan.cn/*
// @match        *://*.yun.123pan.cn/*
// @match        *://www.zhihu.com/*
// @match        *://*.www.zhihu.com/*
// @match        *://bilibili.com/*
// @match        *://*.bilibili.com/*
// @match        *://x.com/*
// @match        *://*.x.com/*
// @match        *://douyin.com/*
// @match        *://*.douyin.com/*
// @match        *://south-plus.net/*
// @match        *://*.south-plus.net/*
// @match        *://laowang.vip/*
// @match        *://*.laowang.vip/*
// @match        *://18comic.vip/*
// @match        *://*.18comic.vip/*
// @match        *://sehuatang.net/*
// @match        *://*.sehuatang.net/*
// @match        *://xsijishe.com/*
// @match        *://*.xsijishe.com/*
// @updateURL    https://raw.githubusercontent.com/hacempo/misc/master/beautify.user.js?v=8.0.2
// @downloadURL  https://raw.githubusercontent.com/hacempo/misc/master/beautify.user.js?v=8.0.2
// @run-at       document-start
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_info
// ==/UserScript==

/*
 * ════════════════════════════════════════════════════════════════════
 *  beautify —— 网站美化 / 元素屏蔽
 *
 *  文件分层（自上而下，下层只依赖上层）：
 *
 *    第 1 层  数据     SITES：站点、页面、全部规则。新增/调整规则只改这里。
 *    第 2 层  模型     把数据规整成运行时对象（规则 ID、默认页签、路径匹配）。
 *    第 3 层  存储     开关状态的读写与跨标签页同步（含旧版数据兼容）。
 *    第 4 层  应用     StyleEngine（CSS 注入）、脚本规则（需要 JS 的特殊规则）、
 *                      Runtime（刷新调度 + 单页应用路由监听）。
 *    第 5 层  界面     设置面板（油猴菜单 → 设置）。
 *    第 6 层  启动     注册菜单；若当前网站在列表中则启动 Runtime。
 *
 *  想加一条规则？只需在第 1 层对应站点的 style / block 数组里加一行。
 * ════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    /* ╔══════════════════════════════════════════════════════════════╗
     * ║  第 1 层　数据：站点与规则                                    ║
     * ╚══════════════════════════════════════════════════════════════╝
     *
     * 每个站点有两类规则，各自有总开关，每条规则也有独立开关：
     *   style  美化：覆盖元素的 CSS（所有声明自动加 !important）
     *   block  屏蔽：直接 display: none
     *
     * ── 规则字段 ────────────────────────────────────────────────────
     *   sel           元素标识符（class / id / 标签等）。CSS 选择器；
     *                 script / note 类规则仅用于界面显示。                 【必填】
     *   at            目录路径：元素在网页中的位置层级，用 " > " 分隔，
     *                 从大到小，如 '全站 > 顶栏'。省略则归入「其他 > 位置待补充」。
     *   what          人话描述：元素是什么 / 美化意图。显示在第二行。
     *   pos           方位词：元素在父级元素中的位置（左侧、右上角、底部…）。
     *                 显示在描述同一行的右侧。可省略。
     *   page          所属页签 id（见站点的 pages）。省略时：
     *                 站点有多个内容页 → 归入「全站」页；只有一个 → 归入那一页。
     *                 「全站」页放对所有（或大部分）页面生效的规则；
     *                 带 except 的规则会在界面上标出「排除 …」。
     *   css           仅 style：要覆盖的声明，如 { 'max-width': 'none' }。
     *
     *   ── 生效条件（全部可省略；省略 = 该站点所有页面都生效）──
     *   hosts         限定域名（含子域）。
     *   paths         仅这些路径生效（前缀匹配：/search 也匹配 /search/x）。
     *   exact         true = paths 要完全相等，不做前缀匹配。
     *   pathIncludes  路径包含任一片段时生效，如 ['/status/']。
     *   except        这些路径（前缀）不生效。
     *   media         仅在该媒体查询下生效，如 '(min-width: 800px)'。
     *   off           true = 默认关闭（用户可在设置里打开）。
     *   （paths 与 pathIncludes 同时出现时，满足其一即生效。）
     *
     *   ── 特殊规则 ──
     *   script        需要 JS 才能完成的规则（如 Shadow DOM），值为
     *                 SCRIPT_HANDLERS 里的处理器名；必须同时写 id 和 title。
     *   note          true = 仅在界面展示，不生效（备忘用）。
     *   title         开关的无障碍标签；缺省用 sel。
     *   id            开关状态的存储 key。省略时按「类型+选择器+条件+css」自动生成，
     *                 因此改了选择器 / css 会让该条开关恢复默认；
     *                 想让开关状态不随修改丢失，就手写一个稳定的 id。
     */

    // 常用 CSS 片段（style 规则里用 ...FILL 之类展开）
    const FILL = {
        width: '100%',
        'max-width': 'none',
        'min-width': '0',
        'box-sizing': 'border-box',
    };
    const NO_SIDE_MARGIN = { 'margin-left': '0', 'margin-right': '0' };
    const NO_SIDE_PADDING = { 'padding-left': '0', 'padding-right': '0' };

    const SITES = [
        // ════════════ 百度贴吧（tieba.baidu.com）════════════
        {
            id: 'tieba',
            name: '百度贴吧',
            hosts: ['tieba.baidu.com'],
            pages: { global: '全站', home: '首页', thread: '帖子' },

            style: [
                // ── 首页 ──
                { sel: '.main-page-wrap', at: '', what: '宽度拉伸', page: 'home', css: { 'max-width': 'none' } },
                // ── 全站 ──
                { sel: '.nav-bar-v2-fixed', at: '', what: '宽度拉伸', css: { 'max-width': 'none' } },
            ],

            block: [
                // ── 首页 ──
                { sel: '.interaction-bar', at: '信息流 > 信息', what: '操作栏', page: 'home', hosts: ['tieba.baidu.com'] },
                // ── 帖子 ──
                { sel: '.login', at: '底部', what: '登录提示', page: 'thread', hosts: ['tieba.baidu.com'] },
                { sel: '.icon_tshows', at: '楼层 > 楼主', what: '等级', page: 'thread', hosts: ['tieba.baidu.com'] },
                { sel: '.level-icon', at: '楼层', what: '等级', page: 'thread', hosts: ['tieba.baidu.com'] },
            ],
        },
        // ════════════ 115 网盘（115.com, 115vod.com）════════════
        {
            id: '115',
            name: '115 网盘',
            hosts: ['115.com', '115vod.com'],
            legacyIds: ['115vod'],   // 旧版把 115vod 当独立站点，其开关数据迁移到这里
            pages: { global: '全站', cloud: '网盘', play: '播放' },

            style: [],

            block: [
                // ── 网盘 ──
                { sel: '#js_bottom_notification', at: '悬浮', what: '', pos: '左侧', page: 'cloud', hosts: ['115.com'] },
                { sel: '.feature-float', at: '悬浮', what: '', pos: '右侧', page: 'cloud', hosts: ['115.com'] },
                { sel: '.promptbar-caution.promptbar-vip-', at: '云下载', what: '法律', page: 'cloud', hosts: ['115.com'] },
                { sel: '.linktask-quota', at: '云下载', what: '配额', page: 'cloud', hosts: ['115.com'] },
                { sel: '.container-leftside', at: '', what: '左栏', page: 'cloud', hosts: ['115.com'] },
                { sel: '[data-nav="photo"]', at: '顶栏', what: '照片', page: 'cloud', hosts: ['115.com'] },
                { sel: '[data-nav="credentials"]', at: '顶栏', what: '密档和证件', page: 'cloud', hosts: ['115.com'] },
                { sel: '[data-nav="note"]', at: '顶栏', what: '记事', page: 'cloud', hosts: ['115.com'] },
                { sel: '.ceiling-feature', at: '顶栏', what: '推广', pos: '中间', page: 'cloud', hosts: ['115.com'] },
                { sel: '.ceiling-link-temp', at: '顶栏', what: '法律', page: 'cloud', hosts: ['115.com'] },
                // ── 播放 ──
                { sel: '.feature-float', at: '悬浮', what: '', pos: '右下角', page: 'play', hosts: ['115vod.com'] },
                { sel: '.vt-handle', at: '顶部', what: 'App 下载', page: 'play', hosts: ['115vod.com'] },
                { sel: '.vt-headline > div', at: '顶部', what: '法律信息', page: 'play', hosts: ['115vod.com'] },
            ],
        },
        // ════════════ JAVDB（javdb.com）════════════
        {
            id: 'javdb',
            name: 'JAVDB',
            hosts: ['javdb.com'],
            pages: { home: '首页' },

            style: [],

            block: [
                // ── 首页 ──
                { sel: '.app-banner', at: '', what: 'App 下载', hosts: ['javdb.com'] },
            ],
        },
        // ════════════ NGA 玩家社区（ngabbs.com）════════════
        {
            id: 'nga',
            name: 'NGA 玩家社区',
            hosts: ['ngabbs.com'],
            pages: { global: '全站', home: '首页', detail: '帖子' },

            style: [],

            block: [
                // ── 全站 ──
                { sel: '.c1', at: '楼层 > 信息列', what: '信息列', page: 'detail', hosts: ['ngabbs.com'] },
                { sel: '.cell', at: '', what: '单元格', page: 'detail', hosts: ['ngabbs.com'] },
                { sel: '#mainmenu', at: '顶部', what: '主菜单', hosts: ['ngabbs.com'] },
                { sel: '#m_nav', at: '顶部', what: '导航栏', hosts: ['ngabbs.com'] },
                { sel: '#m_pbtntop', at: '顶部', what: '翻页栏', hosts: ['ngabbs.com'] },
                { sel: '#fast_post_c', at: '底部', what: '发帖', hosts: ['ngabbs.com'] },
                { sel: '#b_nav', at: '底部', what: '导航栏', hosts: ['ngabbs.com'] },
                { sel: '#footer', at: '底部', what: '页脚', hosts: ['ngabbs.com'] },
                // ── 首页 ──
                { sel: '.topicrow .c3', at: '信息流 > 信息', what: '发帖人和发帖时间', page: 'home', hosts: ['ngabbs.com'] },
                { sel: '.topicrow .c4', at: '信息流 > 信息', what: '最后回复人和回复时间', page: 'home', hosts: ['ngabbs.com'] },
                { sel: '#toptopics', at: '', what: '公告、热门话题', page: 'home', hosts: ['ngabbs.com'] },
                { sel: '.posterInfoLine', at: '', what: '发帖人、发帖时间及最后回复信息', page: 'home', hosts: ['ngabbs.com'] },
            ],
        },
        // ════════════ 123 云盘（yun.123pan.cn）════════════
        {
            id: '123pan',
            name: '123 云盘',
            hosts: ['yun.123pan.cn'],
            pages: { cloud: '网盘' },

            style: [],

            block: [
                // ── 网盘 ──
                { sel: '.notice-box', at: '底部', what: '公告', pos: '右侧', hosts: ['yun.123pan.cn'] },
                { sel: '.entry_p0tlq', at: '底部', what: '推广', pos: '右侧', hosts: ['yun.123pan.cn'] },
                { sel: '.mfy-main-layout__head', at: '顶部', what: '顶部', hosts: ['yun.123pan.cn'] },
                { sel: 'aside', at: '', what: '左栏', hosts: ['yun.123pan.cn'] },
                { sel: '.withSideMenuLayoutSider_ELJ6a', at: '主区', what: '左栏', hosts: ['yun.123pan.cn'] },
            ],
        },
        // ════════════ 知乎（www.zhihu.com）════════════
        {
            id: 'zhihu',
            name: '知乎',
            hosts: ['www.zhihu.com'],
            pages: { global: '全站', home: '首页', question: '回答', search: '搜索' },

            style: [
                // ── 回答 ──
                {
                    sel: '.Question-main',
                    at: '回答页 > 主要内容',
                    what: '让问题页主内容区域铺满可用宽度，并收紧内部栏间距。',
                    page: 'question',
                    css: { ...FILL, ...NO_SIDE_MARGIN, ...NO_SIDE_PADDING },
                },
                {
                    sel: '.Question-mainColumn',
                    at: '回答页 > 主要内容',
                    what: '让回答正文区域占据主栏的可用空间。',
                    page: 'question',
                    css: { ...FILL, ...NO_SIDE_MARGIN, ...NO_SIDE_PADDING },
                },
                {
                    sel: '.css-1gl8cva',
                    at: '回答页 > 主要内容',
                    what: '让回答正文内层区域铺满宽度。',
                    page: 'question',
                    css: { ...FILL, ...NO_SIDE_MARGIN, ...NO_SIDE_PADDING },
                },
                {
                    sel: '.Question-main',
                    at: '回答页 > 主要内容',
                    what: '清除主栏内部的列间距（gap / column-gap 设为 0）。',
                    page: 'question',
                    css: { gap: '0', 'column-gap': '0' },
                },
                {
                    sel: '.Question-mainColumn',
                    at: '回答页 > 主要内容',
                    what: '让正文主栏以弹性布局占满剩余空间并可收缩（flex: 1 1 0%）。',
                    page: 'question',
                    css: { flex: '1 1 0%' },
                },
                // ── 首页 ──
                { sel: '.Topstory-container', at: '主要内容', what: '让首页内容区域铺满可用宽度。', page: 'home', css: { ...FILL, ...NO_SIDE_PADDING } },
                {
                    sel: '.Topstory-mainColumn',
                    at: '主要内容',
                    what: '让首页信息流主栏扩展到可用宽度。',
                    page: 'home',
                    css: { width: '100%', 'max-width': 'none', 'min-width': '0', flex: '1 1 0%', 'margin-right': '0' },
                },
                { sel: '.Topstory-mainColumnCard', at: '主要内容', what: '让首页内容卡片铺满主栏。', page: 'home', css: FILL },
                { sel: '.Topstory-content', at: '主要内容', what: '让首页信息流内容铺满主栏。', page: 'home', css: FILL },
                { sel: '.Topstory-recommend', at: '主要内容', what: '让首页推荐内容铺满主栏。', page: 'home', css: FILL },
                // ── 全站 ──
                {
                    sel: 'div:has(> header.AppHeader)',
                    at: '顶栏',
                    what: '让顶部导航栏与页面内容左右对齐，避免横向溢出。',
                    css: { width: 'var(--beautify-content-width)', 'max-width': 'none', 'box-sizing': 'border-box' },
                },
                { sel: 'header.AppHeader', at: '顶栏', what: '让顶部导航栏铺满可用宽度。', css: { ...FILL, ...NO_SIDE_MARGIN } },
                { sel: 'header.AppHeader > div', at: '顶栏', what: '让顶部导航栏内部内容充分利用可用宽度。', css: { ...FILL, 'max-width': '100%' } },
                {
                    sel: 'header.AppHeader > div > .css-51utkw',
                    at: '顶栏',
                    what: '为顶部导航和搜索区域留出充足空间。',
                    css: { ...FILL, width: 'auto', flex: '1 1 0%' },
                },
                {
                    sel: 'header.AppHeader > div > .css-51utkw > .css-51utkw',
                    at: '顶栏',
                    what: '让顶部导航内容自然延展，不受多余宽度限制。',
                    css: { ...FILL, width: 'auto', flex: '1 1 auto' },
                },
                {
                    sel: 'header.AppHeader .css-1ndlr1n',
                    at: '顶栏',
                    what: '避免顶部导航子区域被挤窄或撑出容器。',
                    css: { 'max-width': '100%', 'min-width': '0', 'box-sizing': 'border-box' },
                },
                {
                    sel: '.css-x84wzl',
                    at: '顶栏',
                    what: '让搜索区域灵活使用导航栏剩余空间，并靠右排列。',
                    css: { 'min-width': '0', 'max-width': '100%', flex: '1 1 0%', 'justify-content': 'flex-end', 'box-sizing': 'border-box' },
                },
                {
                    sel: '.css-x84wzl .SearchBar',
                    at: '顶栏',
                    what: '让顶部搜索框在较宽屏幕上保持舒适宽度。',
                    css: { width: 'clamp(400px, 52vw, 540px)', 'max-width': '100%', flex: '0 1 clamp(400px, 52vw, 540px)', 'box-sizing': 'border-box' },
                    media: '(min-width: 800px)',
                },
                { sel: '.css-x84wzl .SearchBar-tool', at: '顶栏', what: '让搜索框工具区域铺满可用空间。', css: { ...FILL, 'max-width': '100%' } },
                { sel: '.css-14iuq0r', at: '顶栏', what: '让顶部左侧区域不再受固定宽度限制。', css: { 'max-width': 'none' } },
                // ── 回答 ──
                { sel: '.QuestionHeader', at: '回答页 > 顶部问题栏', what: '让问题标题栏铺满可用宽度。', page: 'question', css: { ...FILL, ...NO_SIDE_MARGIN } },
                { sel: '.QuestionHeader-content', at: '回答页 > 顶部问题栏', what: '让问题标题栏内容铺满区域。', page: 'question', css: { ...FILL, ...NO_SIDE_PADDING } },
                { sel: '.QuestionHeader-main', at: '回答页 > 顶部问题栏', what: '让问题标题和主要信息充分利用横向空间。', page: 'question', css: { width: '100%' } },
                // ── 全站 ──
                {
                    sel: '.ContentItem-actions > :nth-child(2)',
                    at: '主要内容 > 具体回答 > 操作栏',
                    what: '收紧回答操作按钮之间的空隙。',
                    css: { 'margin-left': '0' },
                    except: ['/search'],
                },
                {
                    sel: '.ContentItem-actions',
                    at: '主要内容 > 具体回答',
                    what: '让回答底部操作栏与卡片内容边缘对齐。',
                    css: { 'margin-left': '-16px', 'margin-right': '-16px' },
                    except: ['/search'],
                },
                // ── 搜索 ──
                {
                    sel: '.css-1qqx3d0 > :nth-child(2)',
                    at: '搜索 > 主要内容 > 具体回答 > 操作栏',
                    what: '收紧搜索结果操作按钮之间的空隙。',
                    page: 'search',
                    css: { 'margin-left': '0' },
                    paths: ['/search'],
                },
                {
                    sel: '.css-1qqx3d0',
                    at: '搜索 > 主要内容 > 具体回答',
                    what: '让搜索结果底部操作栏与卡片内容边缘对齐。',
                    page: 'search',
                    css: { 'margin-left': '-16px', 'margin-right': '-16px' },
                    paths: ['/search'],
                },
                {
                    sel: '.Search-container',
                    at: '搜索 > 主要内容',
                    what: '让搜索页面内容铺满可用宽度。',
                    page: 'search',
                    css: { padding: '0', width: '100%' },
                    paths: ['/search'],
                },
                {
                    sel: '#SearchMain',
                    at: '搜索 > 主要内容',
                    what: '让搜索结果主区域铺满可用宽度。',
                    page: 'search',
                    css: { 'margin-right': '0', width: '100%' },
                    paths: ['/search'],
                },
                {
                    sel: '.SearchTabs-inner',
                    at: '搜索 > 顶部',
                    what: '让搜索页顶部工具栏铺满宽度，内容保持整齐排列。',
                    page: 'search',
                    css: { display: 'flex', margin: '0', width: '100%', 'max-width': 'none', 'align-items': 'center' },
                    paths: ['/search'],
                },
                {
                    sel: '.SearchTabs-searchBarContainer',
                    at: '搜索 > 顶部 > 悬浮工具栏',
                    what: '让搜索框靠到顶部工具栏右侧。',
                    page: 'search',
                    css: { 'margin-left': 'auto', flex: '0 0 auto' },
                    paths: ['/search'],
                },
                // ── 全站 ──
                {
                    sel: 'div:has(> header.AppHeader)',
                    at: '顶栏',
                    what: '让顶部导航栏与页面内容左右对齐，避免右侧出现横向溢出。',
                    script: 'zhihu-header-width',
                    title: '顶栏宽度自适应',
                    id: 'zhihu-header-width',
                },
            ],

            block: [
                // ── 全站 ──
                { sel: '.css-bkewaf', at: '主要内容', what: '右侧栏', hosts: ['www.zhihu.com'] },
                { sel: '.css-18opwoy', at: '主要内容 > 具体回答 > 评论区 > 评论', what: '评论中的回复和点赞区域', hosts: ['www.zhihu.com'] },
                { sel: '.css-79elbk > :first-child', at: '主要内容 > 具体回答 > 评论区', what: '评论回复框', hosts: ['www.zhihu.com'] },
                { sel: '[aria-label="知乎"]', at: '顶栏', what: '知乎 Logo', hosts: ['www.zhihu.com'] },
                { sel: '[href="https://www.zhihu.com/column-square"]', at: '顶栏', what: '专栏入口', hosts: ['www.zhihu.com'] },
                { sel: '[href="https://www.zhihu.com/ring-feeds"]', at: '顶栏', what: '圈子入口', hosts: ['www.zhihu.com'] },
                { sel: '.css-53paqb', at: '顶栏', what: '导航分隔线', hosts: ['www.zhihu.com'] },
                { sel: '[href="https://www.zhihu.com/project-square"]', at: '顶栏', what: 'AI Works 入口', hosts: ['www.zhihu.com'] },
                { sel: '[href="https://www.zhihu.com/fiore/h5/vip-web"]', at: '顶栏', what: '故事入口', hosts: ['www.zhihu.com'] },
                { sel: '[href="https://zhida.zhihu.com/"]', at: '顶栏', what: '直答入口', hosts: ['www.zhihu.com'] },
                { sel: '.SearchBar-askContainer', at: '顶栏', what: '发布入口', hosts: ['www.zhihu.com'] },
                { sel: '.css-1vbrp2j', at: '顶栏', what: '消息和私信入口', hosts: ['www.zhihu.com'] },
                { sel: '.css-ruapjk', at: '顶栏', what: '头像入口', hosts: ['www.zhihu.com'] },
                {
                    sel: '.ContentItem-actions > :first-child',
                    at: '主要内容 > 具体回答 > 操作栏',
                    what: '回答赞同和反对按钮',
                    hosts: ['www.zhihu.com'],
                    except: ['/search'],
                },
                { sel: '[aria-label="喜欢"]', at: '主要内容 > 具体回答 > 操作栏', what: '喜欢按钮', hosts: ['www.zhihu.com'] },
                { sel: '[data-tooltip="解释这篇内容"]', at: '主要内容 > 具体回答 > 操作栏', what: '解释按钮', hosts: ['www.zhihu.com'] },
                { sel: '.CornerButtonsGroup', at: '', what: 'AI 助手', pos: '右下角', hosts: ['www.zhihu.com'] },
                // ── 首页 ──
                { sel: '.WriteArea', at: '主要内容', what: '写回答区域', page: 'home', hosts: ['www.zhihu.com'] },
                // ── 回答 ──
                { sel: '.QuestionHeader-side', at: '回答页 > 悬浮顶栏', what: '问题栏右侧区域', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.QuestionHeader-footer', at: '回答页 > 顶部问题栏', what: '问题栏底部操作区', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.FollowButton', at: '回答页', what: '关注按钮', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.Reward', at: '回答页 > 具体回答 > 底部', what: '赞赏入口', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.css-140jo2', at: '回答页 > 具体回答 > 评论区', what: '评论发布时间和地点', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.css-dvccr2', at: '回答页 > 具体回答 > 顶部', what: '文章赞同人数', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.css-a3pqj1', at: '回答页 > 评论页', what: '评论框', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.css-kt4t4n', at: '回答页 > 具体回答 > 评论区', what: '悬浮评论框', page: 'question', hosts: ['www.zhihu.com'] },
                { sel: '.css-jghqwm', at: '回答页 > 具体回答 > 底部', what: '继续追问', page: 'question', hosts: ['www.zhihu.com'] },
                // ── 搜索 ──
                {
                    sel: '.css-1qqx3d0 > :first-child',
                    at: '搜索 > 主要内容 > 具体回答 > 操作栏',
                    what: '搜索结果赞同和反对按钮',
                    page: 'search',
                    hosts: ['www.zhihu.com'],
                    paths: ['/search'],
                },
            ],
        },
        // ════════════ 哔哩哔哩（bilibili.com）════════════
        {
            id: 'bilibili',
            name: '哔哩哔哩',
            hosts: ['bilibili.com'],
            pages: { global: '全站', home: '首页', video: '播放', dynamic: '动态' },

            style: [
                // ── 动态 ──
                {
                    sel: 'main',
                    at: '',
                    what: '宽度拉伸',
                    page: 'dynamic',
                    css: { ...FILL, ...NO_SIDE_MARGIN, flex: '1 1 100%', 'grid-column': '1 / -1' },
                    hosts: ['t.bilibili.com'],
                },
                // ── 播放 ──
                {
                    sel: '#commentapp > bili-comments 的 Shadow DOM 内 #contents',
                    at: '评论区',
                    what: '收紧评论区内容顶部的空白，让评论内容更靠近上方导航。',
                    page: 'video',
                    hosts: ['www.bilibili.com'],
                    script: 'bilibili-comments',
                    title: '评论区内容顶部间距',
                    id: 'bili-comment-content-padding',
                },
                {
                    sel: '#commentapp > bili-comments > #header > bili-comments-header-renderer 的 Shadow DOM 内 #navbar',
                    at: '评论区',
                    what: '缩小评论区顶部导航栏下方的空白，让评论列表更紧凑。',
                    page: 'video',
                    hosts: ['www.bilibili.com'],
                    script: 'bilibili-comments',
                    title: '评论区导航栏间距',
                    id: 'bili-comment-navbar-margin',
                },
            ],

            block: [
                // ── 全站 ──
                { sel: '.adblock-tips', at: '', what: '检测到广告屏蔽器的提示', hosts: ['www.bilibili.com'] },
                { sel: '.left-entry-main > :nth-child(n+4)', at: '顶栏', what: '保留前 3 项',
                    pos: '左侧', hosts: ['bilibili.com'] },
                {
                    sel: '.right-entry__main > :not(:nth-child(n+4):nth-child(-n+6))',
                    at: '顶栏',
                    what: '保留第 4 至第 6 项',
                    pos: '右侧',
                    hosts: ['bilibili.com'],
                },
                // ── 首页 ──
                { sel: '.recommended-swipe', at: '卡片', what: '轮播图', pos: '左上角', page: 'home', hosts: ['www.bilibili.com'] },
                { sel: '.floor-single-card', at: '卡片', what: '分区推广', page: 'home', hosts: ['www.bilibili.com'] },
                { sel: '.feed-card:not(:has(.enable-no-interest))', at: '卡片', what: '初始加载的推广', page: 'home', hosts: ['www.bilibili.com'] },
                {
                    sel: '.bili-feed-card:not(:has(.enable-no-interest))',
                    at: '卡片',
                    what: '下滑加载的推广',
                    page: 'home',
                    hosts: ['www.bilibili.com'],
                },
                // ── 播放 ──
                { sel: '.bili-live-card', at: '卡片', what: '直播', page: 'home', hosts: ['www.bilibili.com'] },
                { sel: '.video-resource-list', at: '', what: '视频推广', page: 'video', hosts: ['www.bilibili.com'] },
                {
                    sel: 'bili-comment-thread-renderer:has([data-type="goods"])',
                    at: '评论区',
                    what: '包含商品推广的评论',
                    page: 'video',
                    hosts: ['www.bilibili.com'],
                    script: 'bilibili-comments',
                    title: '商品标记评论',
                    id: 'bili-goods-comments',
                },
                {
                    sel: 'bili-comment-renderer >>> #footer, bili-comment-reply-renderer >>> #footer',
                    at: '评论区',
                    what: '操作栏',
                    pos: '主评论和回复下方',
                    page: 'video',
                    hosts: ['www.bilibili.com'],
                    script: 'bilibili-comments',
                    title: '评论操作栏',
                    id: 'bili-comment-footers',
                },
                {
                    sel: 'bili-comments-header-renderer >>> #commentbox',
                    at: '评论区',
                    what: '评论框',
                    pos: '评论区顶部',
                    page: 'video',
                    hosts: ['www.bilibili.com'],
                    script: 'bilibili-comments',
                    title: '评论输入框',
                    id: 'bili-comment-input',
                },
                {
                    sel: 'bili-comments-header-renderer >>> .bili-comments-bottom-fixed-wrapper',
                    at: '评论区',
                    what: '悬浮评论框',
                    pos: '评论区底部',
                    page: 'video',
                    hosts: ['www.bilibili.com'],
                    script: 'bilibili-comments',
                    title: '悬浮评论输入框',
                    id: 'bili-floating-comment-input',
                },
                // ── 动态 ──
                { sel: 'aside', at: '', what: '右栏', page: 'dynamic', hosts: ['t.bilibili.com'] },
                { sel: '.bili-dyn-publishing', at: '', what: '发布', page: 'dynamic', hosts: ['t.bilibili.com'] },
            ],
        },
        // ════════════ 推特（x.com）════════════
        {
            id: 'x',
            name: '推特',
            hosts: ['x.com'],
            pages: { global: '全站', home: '首页', post: '帖子' },

            style: [
                // ── 全站 ──
                { sel: 'main > :only-child', at: '主区 > 主栏', what: '宽度拉伸', css: { width: '100%', 'max-width': 'none' } },
                { sel: '.r-1ye8kvj', at: '主区', what: '宽度拉伸', css: { width: '100%', 'max-width': 'none', 'min-width': '0' } },
            ],

            block: [
                // ── 全站 ──
                {
                    sel: 'article .r-kzbkwu > :last-child',
                    at: '信息流 > 信息',
                    what: '操作栏',
                    hosts: ['x.com'],
                    paths: ['/home'],
                    exact: true,
                    pathIncludes: ['/status/'],
                    id: 'rule-1bvuu3s',
                },
                { sel: 'header[role="banner"]', at: '', what: '左栏', hosts: ['x.com'] },
                { sel: '[data-testid="sidebarColumn"]', at: '', what: '右栏', hosts: ['x.com'] },
                // ── 首页 ──
                {
                    sel: '[aria-label="主页时间线"] > :nth-child(3)',
                    at: '',
                    what: '发布',
                    page: 'home',
                    hosts: ['x.com'],
                    paths: ['/home'],
                    exact: true,
                },
                { sel: '.r-494qqr', at: '', what: 'App 下载提示', page: 'home', hosts: ['x.com'], paths: ['/home'], exact: true },
                // ── 帖子 ──
                {
                    sel: 'article .r-qklmqi > :first-child',
                    at: '楼层 > 楼主',
                    what: '操作栏',
                    page: 'post',
                    hosts: ['x.com'],
                    pathIncludes: ['/status/'],
                },
                {
                    sel: '[data-testid="inline_reply_offscreen"]',
                    at: '',
                    what: '发布',
                    page: 'post',
                    hosts: ['x.com'],
                    pathIncludes: ['/status/'],
                },
                { sel: '.r-ttdzmv', at: '楼层', what: '空隙', page: 'post', hosts: ['x.com'], pathIncludes: ['/status/'] },
            ],
        },
        // ════════════ 抖音（douyin.com）════════════
        {
            id: 'douyin',
            name: '抖音',
            hosts: ['douyin.com'],
            pages: { home: '首页' },

            style: [],

            block: [
                // ── 首页 ──
                { sel: '.VAQA49VP', at: '评论区 > 评论', what: '发布时间和发布地区', pos: '底部，操作栏上方', hosts: ['douyin.com'] },
                { sel: '.Ctt1baq8', at: '评论区 > 评论', what: '操作栏', pos: '底部', hosts: ['douyin.com'] },
                { sel: '.comment-input-container', at: '评论区', what: '发布', pos: '底部', hosts: ['douyin.com'] },
                { sel: '.semiTabrelated_card', at: '评论区 > 顶栏', what: '切换推荐', hosts: ['douyin.com'] },
                { sel: '.semiTabai_card', at: '评论区 > 顶栏', what: '切换 AI', hosts: ['douyin.com'] },
            ],
        },
        // ════════════ 南+（south-plus.net）════════════
        {
            id: 'southplus',
            name: '南+',
            hosts: ['south-plus.net'],
            pages: { global: '全站', home: '首页', tea: '茶馆', post: '帖子' },

            style: [],

            block: [
                // ── 全站 ──
                { sel: '.container>center', at: '底部', what: '切换桌面版按钮', hosts: ['south-plus.net'], paths: ['/simple/index.php'], exact: true },
                { sel: 'body>center', at: '底部', what: '脚注', hosts: ['south-plus.net'], paths: ['/simple/index.php'], exact: true },
                // ── 茶馆 ──
                { sel: '.pages', at: '顶部', what: '顶部翻页栏', page: 'global', hosts: ['south-plus.net'], paths: ['/simple/index.php'], exact: true },
                {
                    sel: '.by',
                    at: '信息流 > 信息',
                    what: '帖子发布时间等信息',
                    page: 'tea',
                    hosts: ['south-plus.net'],
                    paths: ['/simple/index.php'],
                    exact: true,
                },
                {
                    sel: '.btn-danger',
                    at: '顶部 > 路径栏',
                    what: '发布主题按钮',
                    pos: '右上角',
                    page: 'global',
                    hosts: ['south-plus.net'],
                    paths: ['/simple/index.php'],
                    exact: true,
                },
                // ── 帖子 ──
                {
                    sel: '.btn-outline-secondary',
                    at: '楼层',
                    what: '回复当前楼',
                    page: 'post',
                    hosts: ['south-plus.net'],
                    paths: ['/simple/index.php'],
                    exact: true,
                },
                {
                    sel: 'form[name="FORM"]',
                    at: '',
                    what: '发布',
                    page: 'post',
                    hosts: ['south-plus.net'],
                    paths: ['/simple/index.php'],
                    exact: true,
                },
                {
                    sel: '.blockquote',
                    at: '楼层 > 资源',
                    what: '购买警告',
                    page: 'post',
                    hosts: ['south-plus.net'],
                    paths: ['/simple/index.php'],
                    exact: true,
                },],
        },
        // ════════════ 老王论坛（laowang.vip）════════════
        {
            id: 'laowang',
            name: '老王论坛',
            hosts: ['laowang.vip'],
            pages: { global: '全站', post: '帖子页' },

            style: [],

            block: [
                // ── 全站 ──
                { sel: '#close', at: '', what: 'App 下载提示', page: 'global', hosts: ['laowang.vip'] },
                // ── 帖子页 ──
                { sel: '.anti-scam-warning', at: '楼层', what: '防诈骗警告', hosts: ['laowang.vip'] },
                { sel: '.top_lev', at: '楼层', what: '用户等级', hosts: ['laowang.vip'] },
            ],
        },
        // ════════════ 禁漫天堂（18comic.vip）════════════
        {
            id: '18comic',
            name: '禁漫天堂',
            hosts: ['18comic.vip'],

            style: [],

            block: [
                // ── 全站 ──
                { sel: '.col-sm-3', at: '', what: '广告栏', hosts: ['18comic.vip'] },
            ],
        },
        // ════════════ 98 堂（sehuatang.net）════════════
        {
            id: 'sehuatang',
            name: '98 堂',
            hosts: ['sehuatang.net'],
            pages: { discussion: '综合讨论区' },

            style: [],

            block: [
                // ── 综合讨论区 ──
                { sel: '.n5_zdtys>ul', at: '综合讨论区页', what: '通知', hosts: ['sehuatang.net'] },
            ],
        },
        // ════════════ 司机社（xsijishe.com）════════════
        {
            id: 'xsijishe',
            name: '司机社',
            hosts: ['xsijishe.com'],
            pages: { global: '全站', post: '帖子' },

            style: [],

            block: [
                // ── 全站 ──
                { sel: '.footer', at: '', what: '页脚', page: 'global', hosts: ['xsijishe.com'] },
                { sel: '.xxm-bottom', at: '', what: '', page: 'global', hosts: ['xsijishe.com'] },
                { sel: '.xxmgapb', at: '', what: '间隔', pos: '页脚下方', page: 'global', hosts: ['xsijishe.com'] },
                // ── 帖子 ──
                { sel: '.xxm-reply-meta', at: '楼层', what: '发帖时间、点赞、点踩', hosts: ['xsijishe.com'] },
                { sel: '.xxm-ratelog', at: '楼层', what: '评分', hosts: ['xsijishe.com'] },
                { sel: '.authortitle', at: '楼层 > 用户栏', what: '等级', hosts: ['xsijishe.com'] },
                { sel: '.vtxxmpost', at: '', what: '发布', hosts: ['xsijishe.com'] },
                { sel: '.jnpar-m-tip', at: '楼层', what: '购买', hosts: ['xsijishe.com'] },
                { sel: '.mtw', at: '楼层', what: '人数', hosts: ['xsijishe.com'] },],
        },
    ];

    /* ╔══════════════════════════════════════════════════════════════╗
     * ║  第 2 层　模型：把数据规整成运行时对象                          ║
     * ╚══════════════════════════════════════════════════════════════╝ */

    const SCRIPT_VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : 'dev';

    const FEATURES = [
        { key: 'style', label: '美化' },
        { key: 'block', label: '屏蔽' },
    ];
    const GLOBAL_PAGE = 'global';
    const FALLBACK_PAGES = { all: '全部' };
    const UNKNOWN_LOCATION = '其他 > 位置待补充';
    const DEFAULT_WHAT = {
        style: '让该区域更充分利用页面空间，减少不必要的布局限制。',
        block: '屏蔽该元素',
    };

    // ---- 匹配 ----

    const hostMatches = (host, domain) => host === domain || host.endsWith('.' + domain);
    const pathHasPrefix = (path, prefix) => path === prefix || path.startsWith(prefix + '/');

    const matchesHost = (route, host) =>
        !route.hosts || route.hosts.some(domain => hostMatches(host, domain));

    /** 规则的域名 / 路径条件是否满足（不含开关状态）。 */
    function matchesRoute(route, host, path) {
        if (!matchesHost(route, host)) return false;

        const positives = [];
        if (route.paths) {
            positives.push(route.exact
                ? route.paths.includes(path)
                : route.paths.some(prefix => pathHasPrefix(path, prefix)));
        }
        if (route.pathIncludes) {
            positives.push(route.pathIncludes.some(part => path.includes(part)));
        }
        if (positives.length && !positives.some(Boolean)) return false;

        return !(route.except && route.except.some(prefix => pathHasPrefix(path, prefix)));
    }

    // ---- 规则 ID ----

    const fnv1a = text => {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    };

    /**
     * 未手写 id 时的自动 ID。
     * 算法与 7.x 版本完全一致，所以升级后用户已保存的开关状态不会丢失；
     * 字段名在这里还原成旧版名称（domains / onlyPaths …）只为保持哈希输入不变。
     */
    function autoRuleId(feature, raw) {
        const identity = JSON.stringify({
            selector: raw.sel,
            domains: raw.hosts || [],
            onlyPaths: raw.paths || [],
            excludePaths: raw.except || [],
            onlyPathIncludes: raw.pathIncludes,
            media: raw.media || '',
            declarations: raw.css || null,
            enabled: !raw.off,
        });
        return 'rule-' + fnv1a(feature + ':' + identity);
    }

    // ---- 构建 ----

    const warn = message => console.warn('[beautify] ' + message);

    /** 原始规则 → 运行时规则。数据有明显错误时返回 null（只丢这一条，不影响其他）。 */
    function buildRule(site, feature, raw) {
        const where = `${site.id}/${feature}/${raw.sel}`;
        const kind = raw.script ? 'script' : raw.note ? 'note' : 'css';

        if (!raw.sel) { warn('规则缺少 sel，已忽略：' + where); return null; }
        if (kind === 'css' && feature === 'style' && !raw.css) {
            warn('style 规则缺少 css，已忽略：' + where); return null;
        }

        return {
            id: raw.id || autoRuleId(feature, raw),
            feature,
            kind,
            sel: raw.sel,
            title: raw.title || raw.sel,
            at: raw.at || UNKNOWN_LOCATION,
            what: raw.what ?? DEFAULT_WHAT[feature],
            pos: raw.pos || '',
            page: raw.page || site.defaultPage,
            css: raw.css,
            script: raw.script,
            media: raw.media,
            route: {
                hosts: raw.hosts,
                paths: raw.paths,
                exact: raw.exact,
                pathIncludes: raw.pathIncludes,
                except: raw.except,
            },
            defaultOn: kind !== 'note' && !raw.off,
        };
    }

    function buildSite(raw) {
        const pages = Object.entries(raw.pages || FALLBACK_PAGES).map(([id, label]) => ({ id, label }));
        const contentPages = pages.filter(page => page.id !== GLOBAL_PAGE);

        const site = {
            id: raw.id,
            name: raw.name,
            hosts: raw.hosts,
            legacyIds: raw.legacyIds || [],
            pages,
            // 有多个内容页 → 未指定 page 的规则视为「全站」；只有一页 → 就是那一页
            defaultPage: contentPages.length > 1 ? GLOBAL_PAGE : (contentPages[0]?.id ?? GLOBAL_PAGE),
            rules: {},
        };

        const pageIds = new Set(pages.map(page => page.id));
        for (const { key } of FEATURES) {
            const seen = new Set();
            site.rules[key] = (raw[key] || [])
                .map(rawRule => buildRule(site, key, rawRule))
                .filter(Boolean);
            for (const rule of site.rules[key]) {
                const where = `${site.id}/${key}/${rule.sel}`;
                if (seen.has(rule.id)) warn('规则 id 重复（两条规则的开关会互相影响）：' + where);
                seen.add(rule.id);
                if (!pageIds.has(rule.page)) warn(`page "${rule.page}" 不在该站点的 pages 里，界面上看不到：${where}`);
            }
        }
        return site;
    }

    const sites = SITES.map(buildSite);
    const host = location.hostname.toLowerCase();
    const currentSite = sites.find(site => site.hosts.some(domain => hostMatches(host, domain)));

    /* ╔══════════════════════════════════════════════════════════════╗
     * ║  第 3 层　存储：开关状态                                       ║
     * ╚══════════════════════════════════════════════════════════════╝
     *
     * 三级开关，任一为关则该规则不生效：站点总开关 → 美化/屏蔽总开关 → 单条规则开关。
     * 只保存布尔值；没保存过的取默认（站点/总开关默认开，单条规则取 defaultOn）。
     */

    const Store = (() => {
        const keys = {
            site: siteId => `beautify:site-enabled:${siteId}`,
            feature: (siteId, feature) => `beautify:${feature}-enabled:${siteId}`,
            rule: (siteId, feature, ruleId) => `beautify:item:${feature}:${siteId}:${ruleId}`,
            legacyAll: siteId => `beautify:enabled:${siteId}`,   // 更早版本的单一总开关
        };

        // 本页写入或收到变更通知的值。读取时优先用它，避免依赖管理器的内部更新时机。
        const cache = new Map();

        const read = key => {
            if (cache.has(key)) return cache.get(key);
            const saved = GM_getValue(key, undefined);
            return typeof saved === 'boolean' ? saved : undefined;
        };
        const write = (key, value) => {
            cache.set(key, value);
            GM_setValue(key, value);
        };

        return {
            siteEnabled: site => read(keys.site(site.id)) ?? true,
            setSiteEnabled: (site, on) => write(keys.site(site.id), on),

            featureEnabled(site, feature) {
                const saved = read(keys.feature(site.id, feature));
                if (saved !== undefined) return saved;
                return GM_getValue(keys.legacyAll(site.id), true) !== false;   // 沿用旧版总开关
            },
            setFeatureEnabled: (site, feature, on) => write(keys.feature(site.id, feature), on),

            ruleEnabled(site, rule) {
                const saved = read(keys.rule(site.id, rule.feature, rule.id));
                if (saved !== undefined) return saved;
                // 旧版曾把 115vod 当独立站点，沿用它保存过的单条开关
                for (const legacyId of site.legacyIds) {
                    const old = read(keys.rule(legacyId, rule.feature, rule.id));
                    if (old !== undefined) return old;
                }
                return rule.defaultOn;
            },
            setRuleEnabled: (site, rule, on) => write(keys.rule(site.id, rule.feature, rule.id), on),

            /** 该站点任何开关在别的标签页被修改时调用 onChange。 */
            watch(site, onChange) {
                if (typeof GM_addValueChangeListener !== 'function') return;
                const listen = key => GM_addValueChangeListener(key, (_name, _old, value) => {
                    if (typeof value === 'boolean') cache.set(key, value);
                    else cache.delete(key);
                    onChange();
                });
                listen(keys.site(site.id));
                for (const { key: feature } of FEATURES) {
                    listen(keys.feature(site.id, feature));
                    for (const rule of site.rules[feature]) {
                        if (rule.kind !== 'note') listen(keys.rule(site.id, feature, rule.id));
                    }
                }
            },
        };
    })();

    /* ╔══════════════════════════════════════════════════════════════╗
     * ║  第 4 层　应用：把规则落到网页上                                ║
     * ╚══════════════════════════════════════════════════════════════╝ */

    // ── 4.1 StyleEngine：生成并注入一张样式表 ─────────────────────────

    const StyleEngine = (() => {
        const STYLE_ELEMENT_ID = 'beautify-style';
        let styleEl = null;
        let headWatcher = null;   // document-start 时 <head> 可能还不存在，等它出现

        function toCss(rule) {
            const body = rule.feature === 'block'
                ? '    display: none !important;'
                : Object.entries(rule.css)
                    .map(([property, value]) => `    ${property}: ${value} !important;`)
                    .join('\n');
            const block = `${rule.sel} {\n${body}\n}`;
            return rule.media ? `@media ${rule.media} {\n${block}\n}` : block;
        }

        const stopHeadWatcher = () => {
            if (!headWatcher) return;
            headWatcher.disconnect();
            headWatcher = null;
        };

        /** 把 <style> 挂到 <head>（没有就先挂 <html>）。返回 <head> 是否已存在。 */
        const attach = () => {
            const target = document.head || document.documentElement;
            if (target && styleEl && styleEl.parentNode !== target) target.appendChild(styleEl);
            return Boolean(document.head);
        };

        /** 注入 CSS；传空字符串则移除样式表。 */
        function mount(css) {
            if (!css) {
                if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
                styleEl = null;
                stopHeadWatcher();
                return;
            }
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = STYLE_ELEMENT_ID;
            }
            styleEl.textContent = css;

            if (attach()) {
                stopHeadWatcher();
            } else if (!headWatcher) {
                headWatcher = new MutationObserver(() => { if (attach()) stopHeadWatcher(); });
                headWatcher.observe(document, { childList: true, subtree: true });
            }
        }

        return { toCss, mount };
    })();

    // ── 4.2 脚本规则：纯 CSS 做不到、必须用 JS 的规则 ─────────────────
    //
    // 每个处理器是一个工厂函数，返回 { update(flags) }。
    // flags 形如 { [规则 id]: 是否生效 }，每次开关或路由变化都会重新调用 update。
    // 新增处理器：写一个工厂函数 → 登记到 SCRIPT_HANDLERS
    // → 在数据里加 { script: '处理器名', id, title, … } 规则。

    // 知乎：把顶栏固定外层的宽度绑定到 body 的实际宽度（避免 100vw 含滚动条造成横向溢出）。
    // 对应的 CSS 规则在数据里引用了 var(--beautify-content-width)。
    function createZhihuHeaderWidth() {
        const RULE_ID = 'zhihu-header-width';
        const WIDTH_VAR = '--beautify-content-width';
        let resizeObserver = null;
        let bodyWatcher = null;

        const updateWidth = () => {
            if (!document.body) return;
            const width = document.body.getBoundingClientRect().width;
            if (width > 0) document.documentElement.style.setProperty(WIDTH_VAR, width + 'px');
        };

        const attach = () => {
            if (!document.body) return false;
            if (!resizeObserver) {
                resizeObserver = new ResizeObserver(updateWidth);
                resizeObserver.observe(document.body);
            }
            updateWidth();
            return true;
        };

        const start = () => {
            if (attach() || bodyWatcher) return;
            // document-start 时 body 还没生成：等它出现再挂载
            bodyWatcher = new MutationObserver(() => {
                if (!attach()) return;
                bodyWatcher.disconnect();
                bodyWatcher = null;
            });
            bodyWatcher.observe(document.documentElement, { childList: true });
        };

        const stop = () => {
            if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
            if (bodyWatcher) { bodyWatcher.disconnect(); bodyWatcher = null; }
            document.documentElement.style.removeProperty(WIDTH_VAR);
        };

        return { update: flags => (flags[RULE_ID] ? start() : stop()) };
    }

    /*
     * Bilibili 评论区（Shadow DOM，普通 CSS 无法穿透，只能用 JS 处理）
     *
     * #commentapp > bili-comments 的 shadowRoot
     *   ├─ #contents
     *   ├─ #feed > bili-comment-thread-renderer
     *   └─ #header > bili-comments-header-renderer 的 shadowRoot
     *        └─ #navbar、#commentbox、悬浮输入框
     *
     * 评论是懒加载、层层嵌套的自定义元素，所以用 MutationObserver 持续监听
     * 各层 shadowRoot，变化后在微任务里统一重新套用规则。
     */
    function createBilibiliComments() {
        const RULE = {
            padding: 'bili-comment-content-padding',
            navbar: 'bili-comment-navbar-margin',
            goods: 'bili-goods-comments',
            footers: 'bili-comment-footers',
            input: 'bili-comment-input',
            floatingInput: 'bili-floating-comment-input',
        };
        const SHADOW_COMPONENTS = new Set([
            'bili-comments',
            'bili-comment-thread-renderer',
            'bili-comment-renderer',
            'bili-comment-replies-renderer',
            'bili-comment-reply-renderer',
            'bili-comments-header-renderer',
        ]);

        let flags = {};
        let installed = false;
        let applyScheduled = false;
        const rootObservers = new Map();    // shadowRoot → MutationObserver
        const pendingHosts = new Set();     // 已出现但 shadowRoot 还没挂上的组件
        const originalStyles = new WeakMap();

        /** 设置内联样式并记住原值；value 为 null 时还原。 */
        const setManagedStyle = (element, property, value) => {
            if (!element) return;
            let saved = originalStyles.get(element);

            if (value === null) {
                if (!saved?.has(property)) return;
                const original = saved.get(property);
                if (original.value) element.style.setProperty(property, original.value, original.priority);
                else element.style.removeProperty(property);
                saved.delete(property);
                if (!saved.size) originalStyles.delete(element);
                return;
            }

            if (!saved) {
                saved = new Map();
                originalStyles.set(element, saved);
            }
            if (!saved.has(property)) {
                saved.set(property, {
                    value: element.style.getPropertyValue(property),
                    priority: element.style.getPropertyPriority(property),
                });
            }
            if (
                element.style.getPropertyValue(property) !== value ||
                element.style.getPropertyPriority(property) !== 'important'
            ) {
                element.style.setProperty(property, value, 'important');
            }
        };

        const scheduleApply = () => {
            if (applyScheduled) return;
            applyScheduled = true;
            queueMicrotask(() => {
                applyScheduled = false;
                applyRules();
            });
        };

        const observeRoot = (shadowRoot, isHeader = false) => {
            if (rootObservers.has(shadowRoot)) return;
            const observer = new MutationObserver(scheduleApply);
            observer.observe(shadowRoot, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: isHeader
                    ? ['class', 'style', 'hidden', 'aria-hidden']
                    : ['data-type'],
            });
            rootObservers.set(shadowRoot, observer);
        };

        /** 遍历一条评论（含嵌套 shadowRoot）：隐藏操作栏，并标记商品评论。 */
        const scanThread = thread => {
            let hasGoods = false;
            const walk = node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (flags[RULE.goods] && node.matches('[data-type="goods"]')) hasGoods = true;

                    const tag = node.localName;
                    const shadowRoot = node.shadowRoot;
                    if (shadowRoot) {
                        observeRoot(shadowRoot);
                        if (tag === 'bili-comment-renderer' || tag === 'bili-comment-reply-renderer') {
                            setManagedStyle(
                                shadowRoot.querySelector('#footer'),
                                'display',
                                flags[RULE.footers] ? 'none' : null
                            );
                        }
                        walk(shadowRoot);
                    } else if (SHADOW_COMPONENTS.has(tag)) {
                        pendingHosts.add(node);
                    }
                }
                for (const child of node.children || []) walk(child);
            };
            walk(thread);
            setManagedStyle(thread, 'display', flags[RULE.goods] && hasGoods ? 'none' : null);
        };

        const applyRules = () => {
            const commentsHost = document.querySelector('#commentapp > bili-comments');
            const root = commentsHost && commentsHost.shadowRoot;
            if (!root) {
                if (commentsHost) pendingHosts.add(commentsHost);
                return;
            }

            observeRoot(root);
            setManagedStyle(root.querySelector('#contents'), 'padding-top', flags[RULE.padding] ? '0px' : null);
            root.querySelectorAll('#feed > bili-comment-thread-renderer').forEach(scanThread);

            const headerHost = root.querySelector('#header > bili-comments-header-renderer');
            const headerRoot = headerHost && headerHost.shadowRoot;
            if (headerHost && !headerRoot) {
                pendingHosts.add(headerHost);
                return;
            }
            if (headerRoot) {
                observeRoot(headerRoot, true);
                setManagedStyle(headerRoot.querySelector('#navbar'), 'margin-bottom', flags[RULE.navbar] ? '0px' : null);
                setManagedStyle(headerRoot.querySelector('#commentbox'), 'display', flags[RULE.input] ? 'none' : null);
                setManagedStyle(
                    headerRoot.querySelector('.bili-comments-bottom-fixed-wrapper'),
                    'display',
                    flags[RULE.floatingInput] ? 'none' : null
                );
            }
        };

        /** 首次启用时安装全部监听（只做一次）。 */
        const install = () => {
            const documentObserver = new MutationObserver(scheduleApply);
            documentObserver.observe(document, { childList: true, subtree: true });
            applyRules();

            // 组件刚创建时 shadowRoot 还没挂上，定时（仅页面可见时）补挂观察器
            const pendingTimer = window.setInterval(() => {
                if (document.visibilityState !== 'visible') return;
                let found = false;
                for (const pending of pendingHosts) {
                    if (!pending.isConnected) pendingHosts.delete(pending);
                    else if (pending.shadowRoot) {
                        pendingHosts.delete(pending);
                        observeRoot(pending.shadowRoot, pending.localName === 'bili-comments-header-renderer');
                        found = true;
                    }
                }
                if (found) scheduleApply();
            }, 1000);

            window.addEventListener('pagehide', () => {
                window.clearInterval(pendingTimer);
                documentObserver.disconnect();
                rootObservers.forEach(observer => observer.disconnect());
                rootObservers.clear();
                pendingHosts.clear();
            }, { once: true });

            for (const name of SHADOW_COMPONENTS) {
                window.customElements.whenDefined(name).then(scheduleApply);
            }
        };

        return {
            update(nextFlags) {
                flags = nextFlags;
                if (installed) return scheduleApply();
                installed = true;
                install();
            },
        };
    }

    const SCRIPT_HANDLERS = {
        'zhihu-header-width': createZhihuHeaderWidth,
        'bilibili-comments': createBilibiliComments,
    };

    /** 当前站点上的脚本规则运行器：把各规则的生效状态分发给对应处理器。 */
    function createScriptRunner(site) {
        const groups = new Map();   // 处理器名 → { rules, handler }
        for (const { key } of FEATURES) {
            for (const rule of site.rules[key]) {
                if (rule.kind !== 'script' || !matchesHost(rule.route, host)) continue;
                const createHandler = SCRIPT_HANDLERS[rule.script];
                if (!createHandler) { warn(`未知的 script 处理器 "${rule.script}"：${site.id}/${rule.id}`); continue; }
                if (!groups.has(rule.script)) groups.set(rule.script, { rules: [], handler: createHandler() });
                groups.get(rule.script).rules.push(rule);
            }
        }
        return {
            /** isActive(rule) 决定该规则当前是否生效。 */
            update(isActive) {
                for (const { rules, handler } of groups.values()) {
                    handler.update(Object.fromEntries(rules.map(rule => [rule.id, isActive(rule)])));
                }
            },
        };
    }

    // ── 4.3 Runtime：刷新调度 + 路由监听 ──────────────────────────────

    /**
     * X、知乎等单页应用会在不刷新的情况下切换路由。
     * 钩住 history.pushState / replaceState 并监听 popstate / hashchange，
     * 路由可能变化时调用 onPossibleChange。
     */
    function watchRouteChanges(onPossibleChange) {
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            if (typeof original !== 'function' || original.__beautifyRouteHook) continue;

            const wrapped = function (...args) {
                const result = Reflect.apply(original, this, args);
                queueMicrotask(onPossibleChange);
                return result;
            };
            Object.defineProperty(wrapped, '__beautifyRouteHook', { value: true });

            try {
                Object.defineProperty(history, method, { configurable: true, writable: true, value: wrapped });
            } catch (error) {
                // 某些页面限制修改 History 实例；popstate 仍能覆盖后退 / 前进。
            }
        }
        window.addEventListener('popstate', onPossibleChange);
        window.addEventListener('hashchange', onPossibleChange);
    }

    /** 在当前网站上启动：套用规则，并在开关 / 路由变化时重新套用。 */
    function startRuntime(site) {
        const scripts = createScriptRunner(site);
        let path = location.pathname;

        const isSwitchedOn = rule =>
            Store.siteEnabled(site) &&
            Store.featureEnabled(site, rule.feature) &&
            Store.ruleEnabled(site, rule);
        const isActive = rule => isSwitchedOn(rule) && matchesRoute(rule.route, host, path);

        /** 按当前开关与路径，重新生成整张样式表并通知脚本规则。 */
        function refresh() {
            const css = FEATURES.flatMap(({ key }) =>
                site.rules[key]
                    .filter(rule => rule.kind === 'css' && isActive(rule))
                    .map(StyleEngine.toCss)
            );
            StyleEngine.mount(css.join('\n\n'));
            scripts.update(isActive);
        }

        Store.watch(site, refresh);
        watchRouteChanges(() => {
            if (location.pathname === path) return;
            path = location.pathname;
            refresh();   // 避免 /home 的规则残留到帖子页等其他路由
        });
        refresh();

        return { site, refresh };
    }

    /* ╔══════════════════════════════════════════════════════════════╗
     * ║  第 5 层　界面：设置面板                                        ║
     * ╚══════════════════════════════════════════════════════════════╝
     *
     * 布局：
     *   顶栏（标题 / 保存提示 / 版本 / 关闭）
     *   ├─ 左栏：网站列表（每站一个总开关）
     *   └─ 右侧
     *        ├─ 页面栏：该网站的页签（「全站」页 + 各普通页面）
     *        └─ 规则区：「美化」「屏蔽」两组，各自是可折叠的目录树
     *             目录 = 网页中的位置层级（rule.at），文件 = 一条规则
     *             文件第一行：元素标识符；第二行：人话描述 ＋ 右侧方位词
     */

    const PANEL_CSS = `
/* 外壳 */
:host{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;pointer-events:none;color:#202938;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;}
*{box-sizing:border-box;}
button,input{font:inherit;}
.shell{position:relative;width:min(1080px,calc(100vw - 40px));height:min(780px,calc(100vh - 40px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:#f4f6fa;border:1px solid #dce2eb;border-radius:16px;overflow:hidden;box-shadow:0 22px 80px rgba(17,29,50,.28);pointer-events:auto;}
/* 顶栏 */
.topbar{height:68px;flex:0 0 68px;display:flex;align-items:center;gap:18px;padding:0 24px;background:#fff;border-bottom:1px solid #e4e8ef;box-shadow:0 2px 10px rgba(20,35,60,.04);}
/* 页面栏（页签）*/
.pagebar{min-height:54px;flex:0 0 auto;display:flex;align-items:center;gap:7px;padding:0 22px;background:#fff;border-bottom:1px solid #e4e8ef;overflow-x:auto;scrollbar-width:thin;}
.page-tab{position:relative;flex:0 0 auto;padding:9px 15px;border:0;border-radius:8px;background:transparent;color:#667388;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;}
.page-tab:hover{background:#f4f6fa;color:#34445d;}
.page-tab.active{background:#edf3ff;color:#245bb5;}
.page-tab-count{margin-left:7px;color:#9aa5b5;font-size:11px;font-weight:500;}
.page-tab.active .page-tab-count{color:#6485bd;}
.brand-mark{width:34px;height:34px;border-radius:10px;background:#eaf1ff;color:#2864c5;display:grid;place-items:center;font-weight:800;font-size:17px;}
.top-title{min-width:0;display:flex;flex-direction:column;}
.eyebrow{font-size:11px;letter-spacing:.08em;color:#8390a3;font-weight:700;}
.current-name{font-size:17px;font-weight:750;color:#202938;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.top-spacer{flex:1;}
.save-hint{color:#778397;font-size:12px;white-space:nowrap;}
.right-panel.site-disabled .group{opacity:.48;}
.version-label{padding:4px 8px;border:1px solid #e5e9f0;border-radius:7px;color:#647187;font-size:11px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap;}
.close-button{width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:#657287;font-size:25px;line-height:1;cursor:pointer;}
.close-button:hover{background:#f0f2f6;color:#263247;}
/* 主体：左栏 + 右侧 */
.content{min-height:0;flex:1;display:grid;grid-template-columns:236px minmax(0,1fr);}
.right-panel{min-width:0;min-height:0;display:flex;flex-direction:column;}
.right-panel .pagebar{flex:0 0 auto;}
/* 左栏：网站列表 */
.sidebar{min-height:0;overflow:auto;background:#fff;border-right:1px solid #e4e8ef;padding:24px 14px;}
.side-heading{padding:0 10px 12px;color:#8994a5;font-size:11px;font-weight:750;letter-spacing:.09em;}
.site-list{display:flex;flex-direction:column;gap:4px;}
.site-row{display:flex;align-items:center;gap:3px;margin:2px 0;}
.site-button{min-width:0;flex:1;width:100%;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:10px 8px;border:0;border-radius:9px;background:transparent;color:#4e5b70;text-align:left;cursor:pointer;}
.site-row-toggle{flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:5px 3px;cursor:pointer;}
.site-row-toggle .switch{width:30px;height:17px;}
.site-button:hover{background:#f5f7fb;}
.site-button.active{background:#edf3ff;color:#245bb5;font-weight:700;}
.site-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.site-count{font-size:11px;color:#98a2b1;font-variant-numeric:tabular-nums;}
/* 规则区 */
.main{min-width:0;min-height:0;overflow:auto;padding:24px clamp(18px,4vw,52px) 50px;}
.main-inner{max-width:980px;margin:0 auto;}
.groups{display:grid;grid-template-columns:1fr;gap:18px;}
/* 可折叠目录树 */
.path-group{border-bottom:1px solid #f0f2f6;}
.path-group:last-child{border-bottom:0;}
.path-summary{display:flex;align-items:center;gap:9px;padding:11px 0;color:#4c5d74;font-size:13px;font-weight:700;cursor:pointer;list-style:none;}
.path-summary::-webkit-details-marker{display:none;}
.path-summary::before{content:"›";display:inline-block;color:#8492a7;font-size:18px;line-height:1;transform:rotate(0deg);transition:transform .15s ease;}
.path-group[open]>.path-summary::before{transform:rotate(90deg);}
.path-count{margin-left:auto;color:#9aa5b5;font-size:11px;font-weight:500;}
.path-depth-1>.path-summary{font-size:12px;color:#718097;}
.path-depth-2>.path-summary{font-size:12px;color:#8793a5;}
.path-rule-list{padding:0 0 4px 24px;}
/* 「美化」「屏蔽」分组 */
.group{background:#fff;border:1px solid #e5e9f0;border-radius:13px;overflow:hidden;box-shadow:0 3px 12px rgba(24,39,65,.035);}
.group-head{display:flex;align-items:center;gap:14px;padding:17px 20px;border-bottom:1px solid #edf0f4;}
.group-heading{min-width:0;flex:1;}
.group-title{font-size:16px;font-weight:750;color:#263247;}
.group-desc{margin-top:2px;font-size:12px;color:#8a95a5;}
.master-toggle{display:flex;align-items:center;gap:7px;color:#536176;font-size:12px;white-space:nowrap;cursor:pointer;}
.switch{width:34px;height:19px;accent-color:#2868cf;cursor:pointer;}
/* 规则行：标识符 / 描述 + 方位词 / 开关 */
.rule-list{padding:4px 20px;}
.rule-row{min-height:54px;display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid #f0f2f6;}
.rule-row:last-child{border-bottom:0;}
.rule-info{min-width:0;flex:1;}
.rule-details{display:grid;gap:5px;}
.rule-meta-line{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;min-width:0;}
.rule-selector{min-width:0;color:#172235;font-size:13px;font-weight:800;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;}
.rule-detail-line{min-width:0;color:#34445d;font-size:12px;font-weight:500;line-height:1.55;overflow-wrap:anywhere;}
.rule-position-text{margin-left:auto;color:#7a8698;font-size:11px;line-height:1.45;text-align:right;}
.pending-badge{display:inline-block;margin-left:7px;padding:1px 6px;border-radius:5px;background:#fff2d6;color:#95600c;font-size:10px;font-weight:700;vertical-align:1px;}
.scope-badge{display:inline-block;margin-left:7px;padding:1px 6px;border-radius:5px;background:#fde9e7;color:#a33a2f;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:10px;font-weight:700;vertical-align:1px;}
.rule-toggle{flex:0 0 auto;width:18px;height:18px;accent-color:#2868cf;cursor:pointer;}
.empty{padding:22px 0;color:#a0a9b6;font-size:13px;}
.master-off-style .rule-style,.master-off-block .rule-block{opacity:.45;}
/* 窄屏 */
@media(max-width:700px){
    .shell{width:calc(100vw - 16px);height:calc(100dvh - 24px);border-radius:12px;}
    .topbar{padding:0 14px;gap:10px;}
    .pagebar{min-height:48px;padding:0 10px;gap:4px;}
    .page-tab{padding:8px 11px;font-size:12px;}
    .save-hint{display:none;}
    .version-label{font-size:10px;padding:3px 6px;}
    .content{grid-template-columns:116px minmax(0,1fr);}
    .sidebar{padding:18px 7px;}
    .site-button{padding:9px 5px;font-size:12px;}
    .site-row-toggle{padding:5px 1px;}
    .site-row-toggle .switch{width:27px;height:16px;}
    .site-count{display:none;}
    .main{padding:18px 12px 36px;}
    .group-head{padding:14px 12px;gap:7px;}
    .rule-list{padding:4px 12px;}
    .path-rule-list{padding-left:12px;}
    .path-summary{padding:9px 0;}
    .master-toggle{gap:3px;font-size:11px;}
}
`;

    let panelHost = null;   // 同一时间只开一个面板

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    /** 带标签文字的开关。onChange 收到新的勾选状态。 */
    function makeToggle({ checked, className = 'master-toggle', labelText, onChange }) {
        const label = el('label', className);
        if (labelText) label.append(el('span', '', labelText));
        const input = el('input', 'switch');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => onChange(input.checked));
        label.append(input);
        return { label, input };
    }

    // ---- 目录树 ----

    /** 规则列表 → 按 rule.at 分层的目录树。 */
    function buildLocationTree(rules) {
        const root = { children: new Map(), rules: [] };
        for (const rule of rules) {
            let node = root;
            for (const segment of rule.at.split(' > ').map(part => part.trim()).filter(Boolean)) {
                if (!node.children.has(segment)) node.children.set(segment, { children: new Map(), rules: [] });
                node = node.children.get(segment);
            }
            node.rules.push(rule);
        }
        return root;
    }

    const countTreeRules = node =>
        node.rules.length + [...node.children.values()].reduce((sum, child) => sum + countTreeRules(child), 0);

    // ---- 面板 ----

    /**
     * @param {object}   ctx
     * @param {object[]} ctx.sites        全部站点（模型）
     * @param {object}   ctx.currentSite  当前网页所属站点（可能为 undefined）
     * @param {Function} ctx.onSiteChange 某站点的开关被改动后调用（用于立即刷新当前页）
     */
    function openSettingsPanel(ctx) {
        if (panelHost && panelHost.isConnected) {
            panelHost.shadowRoot.querySelector('.close-button').focus();
            return;
        }

        const state = {
            site: ctx.currentSite || ctx.sites[0],
            pageBySite: new Map(),   // 记住每个站点上次停留的页签
        };

        // ── 骨架 ──
        const panelEl = el('div');
        panelEl.id = 'beautify-settings-host';
        const shadow = panelEl.attachShadow({ mode: 'open' });
        panelHost = panelEl;

        const styleEl = el('style');
        styleEl.textContent = PANEL_CSS;

        const currentName = el('div', 'current-name', state.site.name);
        const saveHint = el('div', 'save-hint', '开关修改后会立即生效');
        const closeButton = el('button', 'close-button', '×');
        closeButton.type = 'button';
        closeButton.title = '关闭设置';
        closeButton.setAttribute('aria-label', '关闭设置');
        closeButton.addEventListener('click', closePanel);

        const topTitle = el('div', 'top-title');
        topTitle.append(el('div', 'eyebrow', 'BEAUTIFY SETTINGS'), currentName);
        const topbar = el('header', 'topbar');
        topbar.append(
            el('div', 'brand-mark', 'B'), topTitle, el('div', 'top-spacer'),
            saveHint, el('div', 'version-label', 'v' + SCRIPT_VERSION), closeButton
        );

        const siteList = el('nav', 'site-list');
        siteList.setAttribute('aria-label', '网站设置');
        const sidebar = el('aside', 'sidebar');
        sidebar.append(el('div', 'side-heading', '网站列表'), siteList);

        const pagebar = el('nav', 'pagebar');
        pagebar.setAttribute('aria-label', '页面类型');
        const mainInner = el('div', 'main-inner');
        const main = el('main', 'main');
        main.append(mainInner);
        const rightPanel = el('section', 'right-panel');
        rightPanel.append(pagebar, main);

        const content = el('div', 'content');
        content.append(sidebar, rightPanel);
        const shell = el('div', 'shell');
        shell.append(topbar, content);
        shadow.append(styleEl, shell);

        // ── 行为 ──
        function closePanel() {
            window.removeEventListener('keydown', onKeyDown);
            if (panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
            if (panelHost === panelEl) panelHost = null;
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') closePanel();
        }

        const updateSavedHint = site => {
            saveHint.textContent = ctx.currentSite?.id === site.id
                ? '已自动保存 · 当前页面立即生效'
                : '已自动保存 · 进入对应网站时生效';
        };

        /** 开关改动后的统一收尾：当前网页所属站点要立即重新套用规则。 */
        const afterChange = site => {
            if (ctx.currentSite?.id === site.id) ctx.onSiteChange(site);
            updateSavedHint(site);
        };

        const rulesOnPage = (site, pageId) => Object.fromEntries(
            FEATURES.map(({ key }) => [key, site.rules[key].filter(rule => rule.page === pageId)])
        );
        const countRulesOnPage = (site, pageId) =>
            FEATURES.reduce((sum, { key }) => sum + rulesOnPage(site, pageId)[key].length, 0);

        // ── 规则行（目录树里的「文件」）──
        function renderRuleRow(site, rule) {
            const row = el('div', 'rule-row rule-' + rule.feature);
            const details = el('div', 'rule-details');

            // 第一行：元素标识符（有排除路径的规则在旁边标出，避免误杀时一眼可见）
            const selectorLine = el('div', 'rule-selector', rule.sel);
            if (rule.route.except?.length) {
                const badge = el('span', 'scope-badge', '排除 ' + rule.route.except.join('、'));
                badge.title = '这些路径下不生效';
                selectorLine.append(badge);
            }
            details.append(selectorLine);

            // 第二行：人话描述，同一行右侧是方位词
            if (rule.what || rule.pos) {
                const meta = el('div', 'rule-meta-line');
                if (rule.what) meta.append(el('span', 'rule-detail-line', rule.what));
                if (rule.pos) meta.append(el('span', 'rule-position-text', rule.pos));
                details.append(meta);
            }

            if (rule.kind === 'note') {
                details.append(el('span', 'pending-badge', '仅展示 · 不启用'));
                const info = el('div', 'rule-info');
                info.append(details);
                row.append(info);
                return row;
            }

            const info = el('div', 'rule-info');
            info.append(details);

            const checkbox = el('input', 'rule-toggle');
            checkbox.type = 'checkbox';
            checkbox.checked = Store.ruleEnabled(site, rule);
            checkbox.title = '启用或关闭此项';
            const syncLabel = () =>
                checkbox.setAttribute('aria-label', (checkbox.checked ? '关闭' : '开启') + rule.title);
            syncLabel();
            checkbox.addEventListener('change', () => {
                Store.setRuleEnabled(site, rule, checkbox.checked);
                syncLabel();
                afterChange(site);
            });

            row.append(info, checkbox);
            return row;
        }

        // ── 目录节点（可折叠）──
        function renderTreeNode(site, name, node, depth = 0) {
            const group = el('details', 'path-group path-depth-' + depth);
            group.open = true;

            const summary = el('summary', 'path-summary');
            summary.append(el('span', '', name), el('span', 'path-count', countTreeRules(node) + ' 项'));

            const body = el('div', 'path-rule-list');
            for (const rule of node.rules) body.append(renderRuleRow(site, rule));
            for (const [childName, child] of node.children) body.append(renderTreeNode(site, childName, child, depth + 1));

            group.append(summary, body);
            return group;
        }

        // ── 「美化」「屏蔽」分组：总开关 + 目录树 ──
        function renderFeatureGroup(site, feature, label, rules) {
            if (!rules.length) return null;

            const group = el('section', 'group');
            const heading = el('div', 'group-heading');
            heading.append(el('div', 'group-title', label), el('div', 'group-desc', '区域作为目录，元素作为文件。'));

            const master = makeToggle({
                checked: Store.featureEnabled(site, feature),
                labelText: label,
                onChange: enabled => {
                    Store.setFeatureEnabled(site, feature, enabled);
                    group.classList.toggle('master-off-' + feature, !enabled);
                    afterChange(site);
                },
            });
            group.classList.toggle('master-off-' + feature, !master.input.checked);

            const head = el('div', 'group-head');
            head.append(heading, master.label);

            const list = el('div', 'rule-list');
            const tree = buildLocationTree(rules);
            for (const [name, node] of tree.children) list.append(renderTreeNode(site, name, node));
            for (const rule of tree.rules) list.append(renderRuleRow(site, rule));

            group.append(head, list);
            return group;
        }

        // ── 页面栏与规则区 ──
        function renderPage(site, pageId) {
            state.pageBySite.set(site.id, pageId);
            mainInner.replaceChildren();

            const onPage = rulesOnPage(site, pageId);
            const groups = el('div', 'groups');
            for (const { key, label } of FEATURES) {
                const group = renderFeatureGroup(site, key, label, onPage[key]);
                if (group) groups.append(group);
            }
            if (!groups.children.length) {
                groups.append(el('div', 'empty', '这个页面暂时没有美化或屏蔽规则。'));
            }
            mainInner.append(groups);

            for (const button of pagebar.querySelectorAll('.page-tab')) {
                const active = button.dataset.pageId === pageId;
                button.classList.toggle('active', active);
                if (active) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            }
            updateSavedHint(site);
        }

        function renderSite(site) {
            state.site = site;
            currentName.textContent = site.name;
            rightPanel.classList.toggle('site-disabled', !Store.siteEnabled(site));
            pagebar.replaceChildren();

            // 只显示有规则的页签
            const tabs = site.pages.filter(page => countRulesOnPage(site, page.id) > 0);
            for (const page of tabs) {
                const button = el('button', 'page-tab');
                button.type = 'button';
                button.dataset.pageId = page.id;
                button.append(el('span', '', page.label), el('span', 'page-tab-count', String(countRulesOnPage(site, page.id))));
                button.addEventListener('click', () => renderPage(site, page.id));
                pagebar.append(button);
            }

            const remembered = state.pageBySite.get(site.id);
            const initialPage = tabs.some(page => page.id === remembered)
                ? remembered
                : (tabs[0]?.id ?? site.pages[0].id);
            renderPage(site, initialPage);

            for (const button of siteList.querySelectorAll('.site-button')) {
                const active = button.dataset.siteId === site.id;
                button.classList.toggle('active', active);
                if (active) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            }
        }

        // ── 左栏：网站列表 ──
        function renderSiteRow(site) {
            const total = FEATURES.reduce((sum, { key }) => sum + site.rules[key].length, 0);

            const button = el('button', 'site-button');
            button.type = 'button';
            button.dataset.siteId = site.id;
            button.append(el('span', 'site-name', site.name), el('span', 'site-count', String(total)));
            button.addEventListener('click', () => renderSite(site));

            const toggleLabel = el('label', 'site-row-toggle');
            const toggle = el('input', 'switch');
            toggle.type = 'checkbox';
            toggle.checked = Store.siteEnabled(site);
            toggle.title = '启用或关闭' + site.name + '的整个网站功能';
            toggle.setAttribute('aria-label', toggle.title);
            toggle.addEventListener('change', () => {
                Store.setSiteEnabled(site, toggle.checked);
                if (state.site === site) rightPanel.classList.toggle('site-disabled', !toggle.checked);
                afterChange(site);
            });
            toggleLabel.append(toggle);

            const row = el('div', 'site-row');
            row.append(button, toggleLabel);
            return row;
        }

        for (const site of ctx.sites) siteList.append(renderSiteRow(site));

        renderSite(state.site);
        window.addEventListener('keydown', onKeyDown);
        (document.body || document.documentElement).appendChild(panelEl);
        closeButton.focus();
    }

    /* ╔══════════════════════════════════════════════════════════════╗
     * ║  第 6 层　启动                                                 ║
     * ╚══════════════════════════════════════════════════════════════╝
     * 设置界面要在所有列表内的网站可用，所以先注册菜单，再决定是否套用规则。 */

    let runtime = null;

    GM_registerMenuCommand('设置', () => openSettingsPanel({
        sites,
        currentSite,
        onSiteChange: site => { if (runtime?.site === site) runtime.refresh(); },
    }));

    if (currentSite) runtime = startRuntime(currentSite);
})();
