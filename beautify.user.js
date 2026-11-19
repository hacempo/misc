// ==UserScript==
// @name         beautify
// @namespace    http://tampermonkey.net/
// @version      6.4
// @description  独立控制指定网站的页面美化与元素屏蔽
// @match        *://*/*
// @run-at       document-start
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    /*
     * 站点列表。每个站点的美化与屏蔽分别控制。
     * 所有功能统一从油猴菜单的「设置」入口管理。
     */
    const SITES = [
        { id: 'tieba', name: '百度贴吧', domains: ['tieba.baidu.com'] },
        { id: '115', name: '115 网盘', domains: ['115.com'] },
        { id: '115vod', name: '115 视频', domains: ['115vod.com'] },
        { id: 'nga', name: 'NGA 玩家社区', domains: ['ngabbs.com'] },
        { id: '123pan', name: '123 云盘', domains: ['yun.123pan.cn'] },
        { id: 'zhihu', name: '知乎', domains: ['www.zhihu.com'] },
        { id: 'bilibili', name: '哔哩哔哩', domains: ['bilibili.com'] },
        { id: 'x', name: 'X', domains: ['x.com'] },
        { id: 'douyin', name: '抖音', domains: ['douyin.com'] }
    ];

    const hostname = location.hostname.toLowerCase();
    const pathname = location.pathname;

    const isDomainMatch = domain =>
        hostname === domain || hostname.endsWith('.' + domain);

    const matchesPath = paths =>
        paths.some(path => pathname === path || pathname.startsWith(path + '/'));

    /*
     * 规则是否对当前页面生效。可选字段：
     *   enabled: false      仅保留记录，不生效
     *   domains             限定域名（含子域）
     *   onlyPaths           仅这些路径生效
     *   excludePaths        这些路径不生效
     */
    // 仅判断规则的域名/路径上下文；是否启用由每条规则自己的开关决定。
    const isRuleActive = rule =>
        (!rule.domains || rule.domains.some(isDomainMatch)) &&
        (!rule.onlyPaths || matchesPath(rule.onlyPaths)) &&
        !(rule.excludePaths && matchesPath(rule.excludePaths));

    const legacyEnabledKey = id => 'beautify:enabled:' + id;
    const featureEnabledKey = (feature, id) => 'beautify:' + feature + '-enabled:' + id;

    // 首次升级时沿用旧版总开关状态，之后两项独立保存。
    const readFeatureEnabled = (site, feature) => {
        const key = featureEnabledKey(feature, site.id);
        const saved = GM_getValue(key, undefined);

        if (typeof saved === 'boolean') return saved;

        const legacyEnabled = GM_getValue(legacyEnabledKey(site.id), true);
        GM_setValue(key, legacyEnabled);
        return legacyEnabled;
    };

    const siteSettings = new Map();

    for (const site of SITES) {
        const styleEnabled = readFeatureEnabled(site, 'style');
        const blockEnabled = readFeatureEnabled(site, 'block');

        siteSettings.set(site.id, {
            style: styleEnabled,
            block: blockEnabled
        });
    }

    const currentSite = SITES.find(site => site.domains.some(isDomainMatch));
    const currentSettings = currentSite && siteSettings.get(currentSite.id);

    // 设置界面需要在所有网站都可访问，因此先完成规则定义和设置菜单注册，
    // 再判断当前网页是否需要注入美化/屏蔽功能。


    /* =====================================================================
     * 样式规则
     * 格式：{ selectors, declarations, media?, domains?, onlyPaths?, excludePaths? }
     * 所有声明自动加 !important；max-width 要取消限制用 none（auto 无效）。
     * ===================================================================== */

    const FILL = {
        width: '100%',
        'max-width': 'none',
        'min-width': '0',
        'box-sizing': 'border-box'
    };
    const NO_SIDE_MARGIN = { 'margin-left': '0', 'margin-right': '0' };
    const NO_SIDE_PADDING = { 'padding-left': '0', 'padding-right': '0' };

    const STYLE_RULES = {
        // 移动端网页。桌面端规则已归档到仓库的 style.txt。
        tieba: [
            {
                // 主页及页面主体取消宽度上限，顶部固定导航栏同理。
                selectors: ['.main-page-wrap', '.nav-bar-v2-fixed'],
                declarations: { 'max-width': 'none' }
            }
        ],

        zhihu: [
            // ---------- 问题页主栏 ----------
            {
                selectors: ['.Question-main', '.Question-mainColumn', '.css-1gl8cva'],
                declarations: { ...FILL, ...NO_SIDE_MARGIN, ...NO_SIDE_PADDING }
            },
            {
                selectors: ['.Question-main'],
                declarations: { gap: '0', 'column-gap': '0' }
            },
            {
                selectors: ['.Question-mainColumn'],
                declarations: { flex: '1 1 0%' }
            },

            // ---------- 首页主栏 ----------
            {
                selectors: ['.Topstory-container'],
                declarations: { ...FILL, ...NO_SIDE_PADDING }
            },
            {
                selectors: ['.Topstory-mainColumn'],
                declarations: {
                    width: '100%',
                    'max-width': 'none',
                    'min-width': '0',
                    flex: '1 1 0%',
                    'margin-right': '0'
                }
            },
            {
                selectors: [
                    '.Topstory-mainColumnCard',
                    '.Topstory-content',
                    '.Topstory-recommend'
                ],
                declarations: FILL
            },

            // ---------- 顶栏 ----------
            {
                // fixed 父容器：宽度由下方脚本按 body 实际宽度写入，
                // 避免 100vw 包含滚动条导致溢出。
                selectors: ['div:has(> header.AppHeader)'],
                declarations: {
                    width: 'var(--beautify-content-width)',
                    'max-width': 'none',
                    'box-sizing': 'border-box'
                }
            },
            {
                selectors: ['header.AppHeader'],
                declarations: { ...FILL, ...NO_SIDE_MARGIN }
            },
            {
                selectors: ['header.AppHeader > div'],
                declarations: { ...FILL, 'max-width': '100%' }
            },
            {
                // 顶栏中间区域：导航 + 搜索
                selectors: ['header.AppHeader > div > .css-51utkw'],
                declarations: { ...FILL, width: 'auto', flex: '1 1 0%' }
            },
            {
                selectors: ['header.AppHeader > div > .css-51utkw > .css-51utkw'],
                declarations: { ...FILL, width: 'auto', flex: '1 1 auto' }
            },
            {
                selectors: ['header.AppHeader .css-1ndlr1n'],
                declarations: {
                    'max-width': '100%',
                    'min-width': '0',
                    'box-sizing': 'border-box'
                }
            },
            {
                // 搜索区占据导航与头像之间的剩余空间，搜索框靠最右。
                selectors: ['.css-x84wzl'],
                declarations: {
                    'min-width': '0',
                    'max-width': '100%',
                    flex: '1 1 0%',
                    'justify-content': 'flex-end',
                    'box-sizing': 'border-box'
                }
            },
            {
                // 搜索框响应式宽度：400px ~ 540px
                media: '(min-width: 800px)',
                selectors: ['.css-x84wzl .SearchBar'],
                declarations: {
                    width: 'clamp(400px, 52vw, 540px)',
                    'max-width': '100%',
                    flex: '0 1 clamp(400px, 52vw, 540px)',
                    'box-sizing': 'border-box'
                }
            },
            {
                selectors: ['.css-x84wzl .SearchBar-tool'],
                declarations: { ...FILL, 'max-width': '100%' }
            },
            {
                // 顶栏及悬浮顶栏靠左
                selectors: ['.css-14iuq0r'],
                declarations: { 'max-width': 'none' }
            },

            // ---------- 回答页 QuestionHeader ----------
            {
                selectors: ['.QuestionHeader'],
                declarations: { ...FILL, ...NO_SIDE_MARGIN }
            },
            {
                selectors: ['.QuestionHeader-content'],
                declarations: { ...FILL, ...NO_SIDE_PADDING }
            },
            {
                selectors: ['.QuestionHeader-main'],
                declarations: { width: '100%' }
            },

            // ---------- 操作栏间距（搜索页与非搜索页 DOM 不同） ----------
            {
                excludePaths: ['/search'],
                selectors: ['.ContentItem-actions > :nth-child(2)'],
                declarations: { 'margin-left': '0' }
            },
            {
                excludePaths: ['/search'],
                selectors: ['.ContentItem-actions'],
                declarations: { 'margin-left': '-16px', 'margin-right': '-16px' }
            },
            {
                onlyPaths: ['/search'],
                selectors: ['.css-1qqx3d0 > :nth-child(2)'],
                declarations: { 'margin-left': '0' }
            },
            {
                onlyPaths: ['/search'],
                selectors: ['.css-1qqx3d0'],
                declarations: { 'margin-left': '-16px', 'margin-right': '-16px' }
            },

            // ---------- 搜索页 ----------
            {
                onlyPaths: ['/search'],
                selectors: ['.Search-container'],
                declarations: { padding: '0', width: '100%' }
            },
            {
                onlyPaths: ['/search'],
                selectors: ['#SearchMain'],
                declarations: { 'margin-right': '0', width: '100%' }
            },
            {
                // 顶栏容器占满宽度并取消居中外边距
                onlyPaths: ['/search'],
                selectors: ['.SearchTabs-inner'],
                declarations: {
                    display: 'flex',
                    margin: '0',
                    width: '100%',
                    'max-width': 'none',
                    'align-items': 'center'
                }
            },
            {
                onlyPaths: ['/search'],
                selectors: ['.SearchTabs-searchBarContainer'],
                declarations: { 'margin-left': 'auto', flex: '0 0 auto' }
            }
        ],

        bilibili: [
            {
                // 动态页主内容区铺满父容器，并解除 flex/grid 列宽限制
                domains: ['t.bilibili.com'],
                selectors: ['main'],
                declarations: {
                    ...FILL,
                    ...NO_SIDE_MARGIN,
                    flex: '1 1 100%',
                    'grid-column': '1 / -1'
                }
            }
        ]
    };

    /*
     * 屏蔽规则（display: none）。
     * 按域名（含子域）匹配；每个选择器单独成条，避免其中一条不被支持时连累其他。
     * 每条规则都在设置界面独立控制；未确认的历史选择器统一归档在 block.txt 末尾注释区。
     * 当前实际生效规则与 block.txt 上方的规则清单保持同步。
     *
     * 贴吧桌面端规则单独归档在 block.txt，不在本脚本中注入。
     */
    const BLOCK_RULES = [
        {
            // 百度贴吧移动端
            domains: ['tieba.baidu.com'],
            selectors: [
                '.login',
                '.icon_tshows',
                '.level-icon',
                '.interaction-bar'
            ]
        },
        {
            // 115 网盘：通知/广告弹窗、左栏、无用导航入口及顶栏广告
            domains: ['115.com'],
            selectors: [
                '#js_bottom_notification',
                '.feature-float',
                '.container-leftside',
                '[data-nav="photo"]',
                '[data-nav="credentials"]',
                '[data-nav="note"]',
                '.ceiling-feature',
                '.ceiling-link-temp'
            ]
        },
        {
            // 115 视频：底部右侧悬浮弹窗
            domains: ['115vod.com'],
            selectors: ['.feature-float']
        },
        {
            // NGA：列表发帖/回帖信息、用户统计、按钮单元格及顶部模块
            domains: ['ngabbs.com'],
            selectors: [
                '.topicrow .c3',
                '.topicrow .c4',
                '.c1',
                '.cell',
                '#toptopics',
                '#fast_post_c'
            ]
        },
        {
            // 123 云盘：公告/广告、顶部区域及两处左侧栏
            domains: ['yun.123pan.cn'],
            selectors: [
                '.notice-box',
                '.entry_p0tlq',
                '.mfy-main-layout__head',
                'aside',
                '.withSideMenuLayoutSider_ELJ6a'
            ]
        },
        {
            // 知乎：侧栏、顶栏入口、问题操作和内容操作
            domains: ['www.zhihu.com'],
            selectors: [
                '.css-bkewaf',
                '.QuestionHeader-side',
                '[href="https://www.zhihu.com/column-square"]',
                '[href="https://www.zhihu.com/ring-feeds"]',
                '.css-53paqb',
                '[href="https://www.zhihu.com/project-square"]',
                '[href="https://www.zhihu.com/fiore/h5/vip-web"]',
                '[href="https://zhida.zhihu.com/"]',
                '.SearchBar-askContainer',
                '.css-1vbrp2j',
                '.css-ruapjk',
                '.QuestionHeader-footer',
                '.FollowButton',
                '.Reward',
                '[aria-label="喜欢"]',
                '[data-tooltip="解释这篇内容"]',
                '.WriteArea',
                '.CornerButtonsGroup',
                '[aria-label="知乎"]'
            ]
        },
        {
            // 知乎非搜索页：回答操作栏第一个按钮（赞同/反对入口）
            domains: ['www.zhihu.com'],
            excludePaths: ['/search'],
            selectors: ['.ContentItem-actions > :first-child']
        },
        {
            // 知乎搜索页：新版 DOM 中回答操作栏第一个按钮
            domains: ['www.zhihu.com'],
            onlyPaths: ['/search'],
            selectors: ['.css-1qqx3d0 > :first-child']
        },
        {
            // 哔哩哔哩：广告提示、首页轮播及确定的广告/直播信息流卡片
            domains: ['www.bilibili.com'],
            selectors: [
                '.adblock-tips',
                '.recommended-swipe',
                '.floor-single-card',
                '.feed-card:not(:has(.enable-no-interest))',
                '.bili-feed-card:not(:has(.enable-no-interest))'
            ]
        },
        {
            // 顶栏存在于所有 Bilibili 子域
            domains: ['bilibili.com'],
            selectors: [
                '.left-entry-main > :nth-child(n+4)',
                '.right-entry__main > :not(:nth-child(n+4):nth-child(-n+6))'
            ]
        },
        {
            // 动态页侧栏及发布区域
            domains: ['t.bilibili.com'],
            selectors: ['aside', '.bili-dyn-publishing']
        },
        {
            // X：首页发帖区域及每条帖子的操作栏
            domains: ['x.com'],
            selectors: [
                '[aria-label="主页时间线"] > :nth-child(3)',
                'article .r-kzbkwu > :last-child'
            ]
        },
        {
            // 抖音：评论信息/操作栏及相关输入、推荐模块
            domains: ['douyin.com'],
            selectors: [
                '.VAQA49VP',
                '.Ctt1baq8',
                '.comment-input-container',
                '.semiTabrelated_card',
                '.semiTabai_card'
            ]
        }
    ];

    /*
     * 未确认/暂不启用的历史屏蔽规则（统一归档在此处，不参与注入）。
     *
     * NGA：旧版元信息条、页脚、导航和菜单项；当前改用 .c1 及用户确认的列表项。
     * ngabbs.com##.posterInfoLine
     * ngabbs.com##.posterInfoLineB
     * ngabbs.com###footer
     * ngabbs.com###b_nav
     * ngabbs.com###m_nav
     * ngabbs.com###m_pbtntop
     * ngabbs.com###mainmenu
     * ngabbs.com###custombg
     *
     * 知乎：用途未确认的动态类名、文章卡片或推广卡片。
     * www.zhihu.com##.css-jghqwm
     * www.zhihu.com##.css-140jo2
     * www.zhihu.com##.css-a3pqj1
     * www.zhihu.com##.css-dvccr2
     * www.zhihu.com##.css-kt4t4n
     * www.zhihu.com##.css-upmq18
     * www.zhihu.com##.css-1fo89v5
     * www.zhihu.com##.css-1m4ta6s
     * www.zhihu.com##.ContentItem-time
     * www.zhihu.com##.TopstoryItem:has(.ArticleItem)
     * www.zhihu.com##.TopstoryItem--advertCard
     * www.zhihu.com##.SearchTabs-profile
     *
     * VoteButton 不单独启用：已由 .ContentItem-actions > :first-child 覆盖。
     * www.zhihu.com##.VoteButton
     *
     * 哔哩哔哩：资源/推荐区域的用途或出现条件尚未确认。
     * www.bilibili.com##.video-resource-list
     * www.bilibili.com##.video-page-special-card-small
     *
     * X：旧版动态类名/侧栏及回复容器选择器，现已由用户确认的首页发帖区和帖子操作栏替代。
     * x.com##header
     * x.com##[data-testid="sidebarColumn"]
     * x.com##[data-testid="inline_reply_offscreen"]
     * x.com##.r-rull8r
     * x.com##[aria-label="主页时间线"] > .r-184en5c
     */


    /* =====================================================================
     * 独立规则设置
     * 每个 CSS 选择器单独保存开关；特殊 JS 规则也纳入设置界面。
     * ===================================================================== */

    const itemEnabledKey = (feature, siteId, itemId) =>
        'beautify:item:' + feature + ':' + siteId + ':' + itemId;

    const isItemEnabled = (feature, siteId, itemId, defaultEnabled = true) =>
        GM_getValue(itemEnabledKey(feature, siteId, itemId), defaultEnabled);

    const hashRuleIdentity = value => {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    };

    const SPECIAL_RULES = {
        zhihu: {
            style: [
                {
                    id: 'zhihu-header-width',
                    title: '顶栏宽度自适应',
                    description: '根据主体实际宽度动态设置顶栏宽度。'
                }
            ],
            block: []
        },
        bilibili: {
            style: [
                {
                    id: 'bili-comment-content-padding',
                    title: '评论区顶部间距',
                    description: '将评论区内容区域 #contents 的顶部内边距设为 0。'
                },
                {
                    id: 'bili-comment-navbar-margin',
                    title: '评论区导航栏间距',
                    description: '将评论区 #navbar 的底部外边距设为 0。'
                }
            ],
            block: [
                {
                    id: 'bili-goods-comments',
                    title: '屏蔽带商品标记的评论',
                    description: '评论或回复包含 data-type="goods" 标记时隐藏整条评论。'
                },
                {
                    id: 'bili-comment-footers',
                    title: '屏蔽评论操作栏',
                    description: '隐藏评论和回复 Shadow DOM 中的 #footer。'
                },
                {
                    id: 'bili-comment-input',
                    title: '屏蔽评论输入框',
                    description: '隐藏评论区顶部输入框 #commentbox。'
                },
                {
                    id: 'bili-floating-comment-input',
                    title: '屏蔽悬浮评论输入框',
                    description: '隐藏底部悬浮输入框。'
                }
            ]
        }
    };


    // 每条规则的可读说明；类名语义不明确的项目会明确标记为待确认。
    const RULE_HINTS = {
        style: {
            tieba: {
                '.main-page-wrap': '取消主内容区域的最大宽度限制。',
                '.nav-bar-v2-fixed': '取消顶部固定导航栏的最大宽度限制。'
            },
            zhihu: {
                '.Question-main': '主内容容器铺满可用宽度，并移除主栏之间的间距。',
                '.Question-mainColumn': '让正文主栏扩展到可用宽度，不再受固定宽度限制。',
                '.css-1gl8cva': '主栏内部容器铺满宽度，清除左右留白。',
                '.Topstory-container': '内容外层铺满宽度，移除左右内边距。',
                '.Topstory-mainColumn': '主内容栏占满剩余空间，取消宽度上限和右侧空白。',
                '.Topstory-mainColumnCard': '主栏卡片铺满可用宽度。',
                '.Topstory-content': '信息流内容区域铺满可用宽度。',
                '.Topstory-recommend': '推荐内容区域铺满可用宽度。',
                'div:has(> header.AppHeader)': '让固定顶栏容器跟随页面实际宽度，避免滚动条造成横向溢出。',
                'header.AppHeader': '让知乎顶栏本身铺满宽度并取消左右外边距。',
                'header.AppHeader > div': '让顶栏内部容器铺满宽度，取消内部最大宽度限制。',
                'header.AppHeader > div > .css-51utkw': '扩展顶栏中间的导航与搜索区域，使其能利用剩余空间。',
                'header.AppHeader > div > .css-51utkw > .css-51utkw': '扩展顶栏内部嵌套区域，避免导航和搜索容器被固定宽度限制。',
                'header.AppHeader .css-1ndlr1n': '限制顶栏子区域不超过可用宽度，并允许其在窄屏下收缩。',
                '.css-x84wzl': '让顶栏搜索区域占据导航和头像之间的剩余空间，并将搜索框靠右排列。',
                '.css-x84wzl .SearchBar': '在较宽屏幕上把搜索框设为响应式宽度（约 400–540px）。',
                '.css-x84wzl .SearchBar-tool': '让搜索工具栏填满搜索框可用宽度。',
                '.css-14iuq0r': '取消顶栏相关区域的最大宽度限制，使其可以向左侧扩展。',
                '.QuestionHeader': '让标题区域铺满可用宽度并取消左右外边距。',
                '.QuestionHeader-content': '让标题内容铺满宽度，并移除左右内边距。',
                '.QuestionHeader-main': '让标题主区域占满父容器宽度。',
                '.ContentItem-actions > :nth-child(2)': '移除内容操作栏第二个按钮左侧的多余间距。',
                '.ContentItem-actions': '扩展内容操作栏，使按钮区域与卡片内容边缘对齐。',
                '.css-1qqx3d0 > :nth-child(2)': '移除内容操作栏第二个按钮左侧的多余间距。',
                '.css-1qqx3d0': '扩展内容操作栏，使按钮区域与卡片内容边缘对齐。',
                '.Search-container': '搜索结果容器铺满宽度，并移除外层内边距。',
                '#SearchMain': '主内容区域铺满宽度，取消右侧空白。',
                '.SearchTabs-inner': '顶部标签栏铺满宽度并取消居中宽度限制。',
                '.SearchTabs-searchBarContainer': '将搜索框容器推到标签栏的右侧。'
            },
            bilibili: {
                'main': '主内容区铺满整行，解除侧栏布局造成的列宽限制。'
            }
        },
        block: {
            tieba: {
                '.login': '隐藏帖子底部悬浮操作栏，以及回帖旁的点赞操作。',
                '.icon_tshows': '隐藏楼主昵称旁边的图标。',
                '.level-icon': '隐藏回帖用户昵称旁边的等级图标。',
                '.interaction-bar': '隐藏页面上的操作栏。'
            },
            '115': {
                '#js_bottom_notification': '隐藏页面底部左侧的通知弹窗。',
                '.feature-float': '隐藏页面底部右侧的悬浮功能弹窗。',
                '.container-leftside': '隐藏网盘页面左侧栏。',
                '[data-nav="photo"]': '隐藏顶栏中的照片入口（替代原来的 album 链接选择器）。',
                '[data-nav="credentials"]': '隐藏顶栏中的密档/证件入口。',
                '[data-nav="note"]': '隐藏顶栏中的记事入口。',
                '.ceiling-feature': '隐藏顶栏中间的广告区域。',
                '.ceiling-link-temp': '隐藏顶栏中的提示链接/提示条。'
            },
            '115vod': {
                '.feature-float': '隐藏底部右侧的悬浮弹窗。'
            },
            nga: {
                '.topicrow .c3': '隐藏帖子列表中的发帖人和发帖时间。',
                '.topicrow .c4': '隐藏帖子列表中的最后回帖人和最后回帖时间。',
                '.c1': '隐藏 c1 信息列中的发帖/回帖人数及发帖人信息。',
                '.cell': '隐藏使用 cell 类的单元格区域，其中包含搜索框、发表新帖等按钮。',
                '#toptopics': '隐藏顶部的大块版头/主题聚合区域，其中包含版块公告、热帖等内容。',
                '#fast_post_c': '隐藏快速发帖区域。'
            },
            '123pan': {
                '.notice-box': '隐藏页面底部右侧的公告提示框。',
                '.entry_p0tlq': '隐藏公告上方的广告模块。',
                '.mfy-main-layout__head': '隐藏云盘主布局顶部区域。',
                'aside': '隐藏页面左侧栏。',
                '.withSideMenuLayoutSider_ELJ6a': '隐藏右侧主要界面布局内部额外的左侧菜单栏。'
            },
            zhihu: {
                '.css-bkewaf': '隐藏知乎侧栏。',
                '.QuestionHeader-side': '隐藏问题标题区域右侧栏，包括滚动时出现的浮动标题栏侧栏。',
                '[href="https://www.zhihu.com/column-square"]': '隐藏顶栏中的专栏广场入口。',
                '[href="https://www.zhihu.com/ring-feeds"]': '隐藏顶栏中的圈子入口。',
                '.css-53paqb': '隐藏顶栏中用于分隔导航入口的竖线。',
                '[href="https://www.zhihu.com/project-square"]': '隐藏顶栏中的 AI Works / 项目广场入口。',
                '[href="https://www.zhihu.com/fiore/h5/vip-web"]': '隐藏顶栏中的会员故事入口。',
                '[href="https://zhida.zhihu.com/"]': '隐藏顶栏中的 AI 直答入口。',
                '.SearchBar-askContainer': '隐藏搜索框旁边的用户发布/提问入口。',
                '.css-1vbrp2j': '隐藏顶栏中的消息和私信入口。',
                '.css-ruapjk': '隐藏顶栏最右侧的头像/用户界面入口。',
                '.QuestionHeader-footer': '隐藏问题标题区域底部的操作模块（关注问题、写回答等）。',
                '.FollowButton': '隐藏问题/回答区域中面向答主的关注按钮。',
                '.Reward': '隐藏回答区域中可能出现的赞赏按钮。',
                '[aria-label="喜欢"]': '隐藏回答操作栏中的喜欢按钮。',
                '[data-tooltip="解释这篇内容"]': '隐藏回答操作栏中的解释内容按钮。',
                '.WriteArea': '隐藏写回答区域。',
                '.CornerButtonsGroup': '隐藏角落的悬浮按钮组（AI 助手）。',
                '[aria-label="知乎"]': '隐藏顶栏中的知乎 Logo/名称区域。',
                '.ContentItem-actions > :first-child': '隐藏回答操作栏第一个按钮，统一覆盖赞同和反对；VoteButton 已包含在这一项中。',
                '.css-1qqx3d0 > :first-child': '隐藏新版回答操作栏的第一个按钮。'
            },
            bilibili: {
                '.adblock-tips': '隐藏广告拦截提示，避免第三方广告拦截实现触发的提示占位。',
                '.recommended-swipe': '隐藏轮播图区域。',
                '.floor-single-card': '隐藏单张分区卡片；其中包含烦人的广告、直播等内容。',
                '.feed-card:not(:has(.enable-no-interest))': '隐藏初始加载的信息流卡片中不含“不感兴趣”入口的卡片。',
                '.bili-feed-card:not(:has(.enable-no-interest))': '隐藏页面下滑后动态加载的信息流卡片中不含“不感兴趣”入口的卡片。',
                '.left-entry-main > :nth-child(n+4)': '隐藏哔哩哔哩顶栏左侧从第 4 项开始的入口。',
                '.right-entry__main > :not(:nth-child(n+4):nth-child(-n+6))': '顶栏右侧只保留第 4 至第 6 个入口，隐藏其余入口。',
                'aside': '隐藏右侧栏。',
                '.bili-dyn-publishing': '隐藏发布/投稿区域。'
            },
            x: {
                '[aria-label="主页时间线"] > :nth-child(3)': '隐藏时间线中的发帖输入/发布区域（第 3 个直接子元素）。',
                'article .r-kzbkwu > :last-child': '隐藏帖子底部的操作栏。'
            },
            douyin: {
                '.VAQA49VP': '隐藏评论信息中的发布时间和发布地区。',
                '.Ctt1baq8': '隐藏抖音评论区每条评论的操作栏。',
                '.comment-input-container': '隐藏评论输入框。',
                '.semiTabrelated_card': '隐藏相关内容推荐卡片。',
                '.semiTabai_card': '隐藏 AI 相关功能卡片。'
            }
        }
    };



    // 设置界面中的页面分类。没有细分页面的站点保留一个总览页签。
    const SITE_PAGES = {
        tieba: [
            { id: 'home', label: '首页' },
            { id: 'thread', label: '帖子详情页' }
        ],
        '115': [
            { id: 'cloud', label: '网盘页' }
        ],
        '115vod': [
            { id: 'video', label: '视频页' }
        ],
        nga: [
            { id: 'home', label: '首页' },
            { id: 'detail', label: '帖子详情页' }
        ],
        '123pan': [
            { id: 'cloud', label: '网盘页' }
        ],
        zhihu: [
            { id: 'home', label: '首页' },
            { id: 'question', label: '问答页' },
            { id: 'search', label: '搜索页' }
        ],
        bilibili: [
            { id: 'home', label: '首页' },
            { id: 'video', label: '视频页' },
            { id: 'dynamic', label: '动态页' }
        ],
        x: [
            { id: 'home', label: '首页' },
            { id: 'detail', label: '帖子详情页' }
        ],
        douyin: [
            { id: 'video', label: '作品/评论页' }
        ]
    };

    /*
     * 规则所属页面。未在此列出的规则视为全站通用，会显示在该网站的每个页面页签中。
     * 同一规则可属于多个页面；所有页签共用同一条规则的保存状态。
     */
    const RULE_PAGE_MAP = {
        style: {
            tieba: {
                '.main-page-wrap': ['home']
            },
            zhihu: {
                '.Question-main': ['question'],
                '.Question-mainColumn': ['question'],
                '.css-1gl8cva': ['question'],
                '.Topstory-container': ['home'],
                '.Topstory-mainColumn': ['home'],
                '.Topstory-mainColumnCard': ['home'],
                '.Topstory-content': ['home'],
                '.Topstory-recommend': ['home'],
                '.QuestionHeader': ['question'],
                '.QuestionHeader-content': ['question'],
                '.QuestionHeader-main': ['question'],
                '.ContentItem-actions > :nth-child(2)': ['home', 'question'],
                '.ContentItem-actions': ['home', 'question'],
                '.css-1qqx3d0 > :nth-child(2)': ['search'],
                '.css-1qqx3d0': ['search'],
                '.Search-container': ['search'],
                '#SearchMain': ['search'],
                '.SearchTabs-inner': ['search'],
                '.SearchTabs-searchBarContainer': ['search']
            },
            bilibili: {
                'main': ['dynamic']
            }
        },
        block: {
            tieba: {
                '.login': ['thread'],
                '.icon_tshows': ['thread'],
                '.level-icon': ['thread'],
                '.interaction-bar': ['home']
            },
            nga: {
                '.topicrow .c3': ['home'],
                '.topicrow .c4': ['home'],
                '.c1': ['home', 'detail'],
                '.cell': ['home', 'detail'],
                '#toptopics': ['home'],
                '#fast_post_c': ['home', 'detail']
            },
            zhihu: {
                '.css-bkewaf': ['home', 'question'],
                '.QuestionHeader-side': ['question'],
                '.QuestionHeader-footer': ['question'],
                '.FollowButton': ['question'],
                '.Reward': ['question'],
                '.ContentItem-actions > :first-child': ['home', 'question'],
                '.css-1qqx3d0 > :first-child': ['search'],
                '.WriteArea': ['home'],
                '.CornerButtonsGroup': ['home', 'question']
            },
            bilibili: {
                '.recommended-swipe': ['home'],
                '.floor-single-card': ['home'],
                '.feed-card:not(:has(.enable-no-interest))': ['home'],
                '.bili-feed-card:not(:has(.enable-no-interest))': ['home'],
                'aside': ['dynamic'],
                '.bili-dyn-publishing': ['dynamic']
            },
            x: {
                '[aria-label="主页时间线"] > :nth-child(3)': ['home'],
                'article .r-kzbkwu > :last-child': ['home', 'detail']
            }
        },
        special: {
            style: {
                zhihu: {
                    'zhihu-header-width': ['home', 'question', 'search']
                },
                bilibili: {
                    'bili-comment-content-padding': ['video'],
                    'bili-comment-navbar-margin': ['video']
                }
            },
            block: {
                bilibili: {
                    'bili-goods-comments': ['video'],
                    'bili-comment-footers': ['video'],
                    'bili-comment-input': ['video'],
                    'bili-floating-comment-input': ['video']
                }
            }
        }
    };

    const getRulePages = (site, feature, ruleKey, isSpecial = false) => {
        const pageIds = (SITE_PAGES[site.id] || [{ id: 'all', label: '全部' }])
            .map(page => page.id);
        const map = isSpecial
            ? RULE_PAGE_MAP.special?.[feature]?.[site.id]
            : RULE_PAGE_MAP[feature]?.[site.id];
        return map?.[ruleKey] || pageIds;
    };

    const ruleItemId = (feature, rule, selector) => {
        const identity = JSON.stringify({
            selector,
            domains: rule.domains || [],
            onlyPaths: rule.onlyPaths || [],
            excludePaths: rule.excludePaths || [],
            media: rule.media || '',
            declarations: rule.declarations || null,
            enabled: rule.enabled !== false
        });
        return 'rule-' + hashRuleIdentity(feature + ':' + identity);
    };

    const getSiteRuleItems = site => {
        const style = (STYLE_RULES[site.id] || []).flatMap(rule =>
            rule.selectors.map(selector => ({
                id: ruleItemId('style', rule, selector),
                feature: 'style',
                title: selector,
                description: RULE_HINTS.style[site.id]?.[selector] ||
                    '此项美化规则的具体作用待确认。',
                pages: getRulePages(site, 'style', selector),
                detail: rule.media ? '媒体条件：' + rule.media : '',
                rule,
                selector,
                defaultEnabled: rule.enabled !== false
            }))
        );

        const block = BLOCK_RULES
            .filter(rule => !rule.domains || rule.domains.some(domain =>
                site.domains.some(siteDomain =>
                    siteDomain === domain ||
                    siteDomain.endsWith('.' + domain) ||
                    domain.endsWith('.' + siteDomain)
                )
            ))
            .flatMap(rule => rule.selectors.map(selector => ({
                id: ruleItemId('block', rule, selector),
                feature: 'block',
                title: selector,
                description: RULE_HINTS.block[site.id]?.[selector] ||
                    '此项屏蔽规则的具体作用待确认。',
                pages: getRulePages(site, 'block', selector),
                detail: '',
                rule,
                selector,
                defaultEnabled: rule.enabled !== false
            })));

        const special = SPECIAL_RULES[site.id] || { style: [], block: [] };
        return {
            style: [...style, ...special.style.map(item => ({
                ...item,
                feature: 'style',
                pages: getRulePages(site, 'style', item.id, true),
                detail: '',
                special: true,
                defaultEnabled: true
            }))],
            block: [...block, ...special.block.map(item => ({
                ...item,
                feature: 'block',
                pages: getRulePages(site, 'block', item.id, true),
                detail: '',
                special: true,
                defaultEnabled: true
            }))]
        };
    };

    const allSiteRuleItems = new Map(
        SITES.map(site => [site.id, getSiteRuleItems(site)])
    );

    let settingsHost = null;

    function openSettings() {
        if (settingsHost && settingsHost.isConnected) {
            settingsHost.shadowRoot.querySelector('.close-button').focus();
            return;
        }

        const selectedAtStart = currentSite || SITES[0];
        let selectedSite = selectedAtStart;

        const host = document.createElement('div');
        host.id = 'beautify-settings-host';
        const root = host.attachShadow({ mode: 'open' });
        settingsHost = host;

        const style = document.createElement('style');
        style.textContent = [
            ':host{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;pointer-events:none;color:#202938;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;}',
            '*{box-sizing:border-box;}',
            'button,input{font:inherit;}',
            '.shell{position:relative;width:min(1080px,calc(100vw - 40px));height:min(780px,calc(100vh - 40px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:#f4f6fa;border:1px solid #dce2eb;border-radius:16px;overflow:hidden;box-shadow:0 22px 80px rgba(17,29,50,.28);pointer-events:auto;}',
            '.topbar{height:68px;flex:0 0 68px;display:flex;align-items:center;gap:18px;padding:0 24px;background:#fff;border-bottom:1px solid #e4e8ef;box-shadow:0 2px 10px rgba(20,35,60,.04);}',
            '.pagebar{min-height:54px;flex:0 0 auto;display:flex;align-items:center;gap:7px;padding:0 22px;background:#fff;border-bottom:1px solid #e4e8ef;overflow-x:auto;scrollbar-width:thin;}',
            '.page-tab{position:relative;flex:0 0 auto;padding:9px 15px;border:0;border-radius:8px;background:transparent;color:#667388;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;}',
            '.page-tab:hover{background:#f4f6fa;color:#34445d;}',
            '.page-tab.active{background:#edf3ff;color:#245bb5;}',
            '.page-tab-count{margin-left:7px;color:#9aa5b5;font-size:11px;font-weight:500;}',
            '.page-tab.active .page-tab-count{color:#6485bd;}',
            '.brand-mark{width:34px;height:34px;border-radius:10px;background:#eaf1ff;color:#2864c5;display:grid;place-items:center;font-weight:800;font-size:17px;}',
            '.top-title{min-width:0;display:flex;flex-direction:column;}',
            '.eyebrow{font-size:11px;letter-spacing:.08em;color:#8390a3;font-weight:700;}',
            '.current-name{font-size:17px;font-weight:750;color:#202938;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.top-spacer{flex:1;}',
            '.save-hint{color:#778397;font-size:12px;white-space:nowrap;}',
            '.close-button{width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:#657287;font-size:25px;line-height:1;cursor:pointer;}',
            '.close-button:hover{background:#f0f2f6;color:#263247;}',
            '.content{min-height:0;flex:1;display:grid;grid-template-columns:236px minmax(0,1fr);}',
            '.sidebar{min-height:0;overflow:auto;background:#fff;border-right:1px solid #e4e8ef;padding:24px 14px;}',
            '.side-heading{padding:0 10px 12px;color:#8994a5;font-size:11px;font-weight:750;letter-spacing:.09em;}',
            '.site-list{display:flex;flex-direction:column;gap:4px;}',
            '.site-button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;border:0;border-radius:9px;background:transparent;color:#4e5b70;text-align:left;cursor:pointer;}',
            '.site-button:hover{background:#f5f7fb;}',
            '.site-button.active{background:#edf3ff;color:#245bb5;font-weight:700;}',
            '.site-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.site-count{font-size:11px;color:#98a2b1;font-variant-numeric:tabular-nums;}',
            '.main{min-width:0;min-height:0;overflow:auto;padding:24px clamp(18px,4vw,52px) 50px;}',
            '.main-inner{max-width:980px;margin:0 auto;}',
            '.groups{display:grid;grid-template-columns:1fr;gap:18px;}',
            '.group{background:#fff;border:1px solid #e5e9f0;border-radius:13px;overflow:hidden;box-shadow:0 3px 12px rgba(24,39,65,.035);}',
            '.group-head{display:flex;align-items:center;gap:14px;padding:17px 20px;border-bottom:1px solid #edf0f4;}',
            '.group-heading{min-width:0;flex:1;}',
            '.group-title{font-size:16px;font-weight:750;color:#263247;}',
            '.group-desc{margin-top:2px;font-size:12px;color:#8a95a5;}',
            '.group-count{margin-right:6px;color:#98a2b1;font-size:12px;white-space:nowrap;}',
            '.master-toggle{display:flex;align-items:center;gap:7px;color:#536176;font-size:12px;white-space:nowrap;cursor:pointer;}',
            '.switch{width:34px;height:19px;accent-color:#2868cf;cursor:pointer;}',
            '.rule-list{padding:4px 20px;}',
            '.rule-row{min-height:54px;display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid #f0f2f6;}',
            '.rule-row:last-child{border-bottom:0;}',
            '.rule-info{min-width:0;flex:1;}',
            '.rule-title{display:block;color:#354257;font-size:13px;overflow-wrap:anywhere;}',
            '.rule-title code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#36475f;background:#f5f7fa;padding:2px 5px;border-radius:4px;}',
            '.rule-description{margin-top:4px;color:#647187;font-size:12px;line-height:1.45;overflow-wrap:anywhere;}',
            '.rule-description.pending{color:#9a6412;}',
            '.pending-badge{display:inline-block;margin-left:7px;padding:1px 6px;border-radius:5px;background:#fff2d6;color:#95600c;font-size:10px;font-weight:700;vertical-align:1px;}',
            '.rule-detail{margin-top:4px;color:#929cac;font-size:10px;overflow-wrap:anywhere;}',
            '.rule-toggle{flex:0 0 auto;width:18px;height:18px;accent-color:#2868cf;cursor:pointer;}',
            '.empty{padding:22px 0;color:#a0a9b6;font-size:13px;}',
            '.master-off .rule-list{opacity:.65;}',
            '.footer-note{margin:18px 2px 0;color:#98a2b1;font-size:12px;}',
            '@media(max-width:700px){.shell{width:calc(100vw - 16px);height:calc(100dvh - 24px);border-radius:12px;}.topbar{padding:0 14px;gap:10px;}.pagebar{min-height:48px;padding:0 10px;gap:4px;}.page-tab{padding:8px 11px;font-size:12px;}.save-hint{display:none;}.content{grid-template-columns:116px minmax(0,1fr);}.sidebar{padding:18px 7px;}.site-button{padding:9px 7px;font-size:12px;}.site-count{display:none;}.main{padding:18px 12px 36px;}.group-head{padding:14px 12px;gap:7px;}.rule-list{padding:4px 12px;}.group-desc{max-width:180px;}.master-toggle{gap:3px;font-size:11px;}.group-count{display:none;}}'
        ].join('\n');

        const makeElement = (tag, className, text) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };

        const shell = makeElement('div', 'shell');
        const topbar = makeElement('header', 'topbar');
        const mark = makeElement('div', 'brand-mark', 'B');
        const topTitle = makeElement('div', 'top-title');
        const eyebrow = makeElement('div', 'eyebrow', 'BEAUTIFY SETTINGS');
        const currentName = makeElement('div', 'current-name', selectedSite.name);
        topTitle.append(eyebrow, currentName);
        const spacer = makeElement('div', 'top-spacer');
        const saveHint = makeElement('div', 'save-hint', '设置自动保存 · 刷新网页后生效');
        const closeButton = makeElement('button', 'close-button', '×');
        closeButton.type = 'button';
        closeButton.title = '关闭设置';
        closeButton.setAttribute('aria-label', '关闭设置');
        closeButton.addEventListener('click', closeSettings);
        topbar.append(mark, topTitle, spacer, saveHint, closeButton);

        const pagebar = makeElement('nav', 'pagebar');
        pagebar.setAttribute('aria-label', '页面类型');

        const contentArea = makeElement('div', 'content');
        const sidebar = makeElement('aside', 'sidebar');
        sidebar.append(makeElement('div', 'side-heading', '网站列表'));
        const siteList = makeElement('nav', 'site-list');
        siteList.setAttribute('aria-label', '网站设置');
        sidebar.append(siteList);
        const main = makeElement('main', 'main');
        const mainInner = makeElement('div', 'main-inner');
        main.append(mainInner);
        contentArea.append(sidebar, main);
        shell.append(topbar, pagebar, contentArea);
        root.append(style, shell);

        function closeSettings() {
            window.removeEventListener('keydown', onKeyDown);
            if (host.parentNode) host.parentNode.removeChild(host);
            if (settingsHost === host) settingsHost = null;
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') closeSettings();
        }

        const updateSavedHint = () => {
            saveHint.textContent = '已自动保存 · 刷新对应网页后生效';
        };

        const makeToggle = (checked, className, onChange, labelText) => {
            const label = makeElement('label', className || 'master-toggle');
            if (labelText) label.append(makeElement('span', '', labelText));
            const input = makeElement('input', 'switch');
            input.type = 'checkbox';
            input.checked = checked;
            input.addEventListener('change', () => onChange(input.checked));
            label.append(input);
            return { label, input };
        };

        const getMeta = item => {
            if (item.special || !item.rule?.media) return '';
            return '媒体条件：' + item.rule.media;
        };

        const makeRuleRow = (site, feature, item) => {
            const row = makeElement('div', 'rule-row');
            const info = makeElement('div', 'rule-info');
            const title = makeElement('div', 'rule-title');
            if (item.special) {
                title.textContent = item.title;
            } else {
                const code = makeElement('code', '', item.title);
                title.append(code);
            }
            const description = makeElement(
                'div',
                'rule-description' + (item.descriptionPending ? ' pending' : ''),
                item.description || '此项规则的具体作用待确认。'
            );
            if (item.descriptionPending) {
                description.append(makeElement('span', 'pending-badge', '待确认'));
            }

            info.append(title, description);
            const metaText = getMeta(item);
            if (metaText) info.append(makeElement('div', 'rule-detail', metaText));

            const checkbox = makeElement('input', 'rule-toggle');
            checkbox.type = 'checkbox';
            checkbox.checked = isItemEnabled(feature, site.id, item.id, item.defaultEnabled);
            checkbox.title = '启用或关闭此项';
            checkbox.setAttribute('aria-label', (checkbox.checked ? '关闭' : '开启') + item.title);
            checkbox.addEventListener('change', () => {
                GM_setValue(itemEnabledKey(feature, site.id, item.id), checkbox.checked);
                checkbox.setAttribute('aria-label', (checkbox.checked ? '关闭' : '开启') + item.title);
                updateSavedHint();
            });

            row.append(info, checkbox);
            return row;
        };

        const renderGroup = (site, feature, title, description, items) => {
            const group = makeElement('section', 'group');
            const head = makeElement('div', 'group-head');
            const heading = makeElement('div', 'group-heading');
            heading.append(
                makeElement('div', 'group-title', title),
                makeElement('div', 'group-desc', description)
            );

            const count = makeElement('div', 'group-count', items.length + ' 项');
            const master = makeToggle(
                GM_getValue(featureEnabledKey(feature, site.id), true),
                'master-toggle',
                enabled => {
                    GM_setValue(featureEnabledKey(feature, site.id), enabled);
                    group.classList.toggle('master-off', !enabled);
                    updateSavedHint();
                },
                '全站总开关'
            );

            head.append(heading, count, master.label);
            const list = makeElement('div', 'rule-list');
            if (items.length === 0) {
                list.append(makeElement('div', 'empty', '这个网站暂时没有配置此类规则。'));
            } else {
                for (const item of items) list.append(makeRuleRow(site, feature, item));
            }

            group.append(head, list);
            group.classList.toggle('master-off', !master.input.checked);
            return group;
        };

        const selectedPageBySite = new Map();

        const getPages = site => SITE_PAGES[site.id] || [{ id: 'all', label: '全部' }];

        const getPageRuleCounts = (site, pageId) => {
            const items = allSiteRuleItems.get(site.id);
            return items.style.filter(item => item.pages.includes(pageId)).length +
                items.block.filter(item => item.pages.includes(pageId)).length;
        };

        function renderPage(site, pageId) {
            selectedPageBySite.set(site.id, pageId);
            mainInner.replaceChildren();

            const items = allSiteRuleItems.get(site.id);
            const visibleStyle = items.style.filter(item => item.pages.includes(pageId));
            const visibleBlock = items.block.filter(item => item.pages.includes(pageId));
            const groups = makeElement('div', 'groups');
            groups.append(
                renderGroup(site, 'style', '页面美化', '调整当前页面的布局、宽度和间距。', visibleStyle),
                renderGroup(site, 'block', '元素屏蔽', '隐藏当前页面不需要的元素。', visibleBlock)
            );
            mainInner.append(groups);

            const page = getPages(site).find(item => item.id === pageId);
            for (const button of pagebar.querySelectorAll('.page-tab')) {
                const active = button.dataset.pageId === pageId;
                button.classList.toggle('active', active);
                if (active) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            }
            updateSavedHint();
        }

        function renderSite(site) {
            selectedSite = site;
            currentName.textContent = site.name;
            pagebar.replaceChildren();

            const pages = getPages(site);
            const rememberedPage = selectedPageBySite.get(site.id);
            const initialPageId = pages.some(page => page.id === rememberedPage)
                ? rememberedPage
                : pages[0].id;

            for (const page of pages) {
                const button = makeElement('button', 'page-tab');
                button.type = 'button';
                button.dataset.pageId = page.id;
                button.append(makeElement('span', '', page.label));

                const count = getPageRuleCounts(site, page.id);
                button.append(makeElement('span', 'page-tab-count', String(count)));
                button.addEventListener('click', () => renderPage(site, page.id));
                pagebar.append(button);
            }

            renderPage(site, initialPageId);

            for (const button of siteList.querySelectorAll('.site-button')) {
                const active = button.dataset.siteId === site.id;
                button.classList.toggle('active', active);
                if (active) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            }
        }

        for (const site of SITES) {
            const items = allSiteRuleItems.get(site.id);
            const total = items.style.length + items.block.length;
            const button = makeElement('button', 'site-button');
            button.type = 'button';
            button.dataset.siteId = site.id;
            const name = makeElement('span', 'site-name', site.name);
            const count = makeElement('span', 'site-count', String(total));
            button.append(name, count);
            button.addEventListener('click', () => renderSite(site));
            siteList.append(button);
        }

        renderSite(selectedSite);
        window.addEventListener('keydown', onKeyDown);
        (document.body || document.documentElement).appendChild(host);
        closeButton.focus();
    }

    GM_registerMenuCommand('设置', openSettings);

    // 非目标网站、或该站点的两项总开关都关闭：不注入页面规则，但仍保留设置入口。
    if (!currentSite || (!currentSettings.style && !currentSettings.block)) return;

    /* =====================================================================
     * 生成并注入 CSS（样式在前、屏蔽在后，屏蔽优先）
     * ===================================================================== */

    const buildStyleRule = rule => {
        const declarations = Object.entries(rule.declarations)
            .map(([property, value]) => `    ${property}: ${value} !important;`)
            .join('\n');
        const body = `${rule.selectors.join(',\n')} {\n${declarations}\n}`;

        return rule.media ? `@media ${rule.media} {\n${body}\n}` : body;
    };

    const currentRuleItems = allSiteRuleItems.get(currentSite.id);

    const styleCss = currentSettings.style
        ? currentRuleItems.style
            .filter(item =>
                !item.special &&
                isRuleActive(item.rule) &&
                isItemEnabled('style', currentSite.id, item.id, item.defaultEnabled)
            )
            .map(item => buildStyleRule({
                ...item.rule,
                selectors: [item.selector]
            }))
        : [];

    const blockCss = currentSettings.block
        ? currentRuleItems.block
            .filter(item =>
                !item.special &&
                isRuleActive(item.rule) &&
                isItemEnabled('block', currentSite.id, item.id, item.defaultEnabled)
            )
            .map(item => `${item.selector} {\n    display: none !important;\n}`)
        : [];

    const mountStyle = css => {
        const style = document.createElement('style');
        style.id = 'beautify-style';
        style.textContent = css;

        // document-start 时 head 可能还不存在：先挂到 documentElement，
        // 等 head 出现后再移进去。
        const attach = () => {
            const target = document.head || document.documentElement;

            if (target && style.parentNode !== target) target.appendChild(style);

            return Boolean(document.head);
        };

        if (!attach()) {
            const observer = new MutationObserver(() => {
                if (attach()) observer.disconnect();
            });
            observer.observe(document, { childList: true, subtree: true });
        }
    };

    const allCss = [...styleCss, ...blockCss].join('\n\n');
    if (allCss) mountStyle(allCss);


    /* =====================================================================
     * 知乎：按 body 实际宽度动态设置顶栏宽度变量 --beautify-content-width
     * ===================================================================== */

    const watchZhihuContentWidth = () => {
        const update = () => {
            const width = document.body.getBoundingClientRect().width;

            if (width > 0) {
                document.documentElement.style.setProperty(
                    '--beautify-content-width',
                    width + 'px'
                );
            }
        };

        const start = () => new ResizeObserver(update).observe(document.body);

        // document-start 时 body 可能尚未创建
        if (document.body) {
            start();
            return;
        }

        const observer = new MutationObserver(() => {
            if (!document.body) return;
            observer.disconnect();
            start();
        });
        observer.observe(document.documentElement, { childList: true });
    };

    if (
        currentSite.id === 'zhihu' &&
        currentSettings.style &&
        isItemEnabled('style', 'zhihu', 'zhihu-header-width')
    ) {
        watchZhihuContentWidth();
    }


    /* =====================================================================
     * Bilibili 评论区（Shadow DOM，普通 CSS 无法穿透，只能用 JS 处理）
     *
     * #commentapp > bili-comments 的 shadowRoot
     *   ├─ #contents
     *   ├─ #feed > bili-comment-thread-renderer
     *   └─ #header > bili-comments-header-renderer 的 shadowRoot
     *        └─ #navbar、#commentbox、悬浮输入框
     * ===================================================================== */

    const installBilibiliShadowRules = ({
        commentPadding,
        navbarMargin,
        goodsComments,
        commentFooters,
        commentInput,
        floatingCommentInput
    }) => {
        const hasActiveRule = [
            commentPadding, navbarMargin, goodsComments,
            commentFooters, commentInput, floatingCommentInput
        ].some(Boolean);

        if (hostname !== 'www.bilibili.com' || !hasActiveRule) return;

        const SHADOW_COMPONENTS = new Set([
            'bili-comments',
            'bili-comment-thread-renderer',
            'bili-comment-renderer',
            'bili-comment-replies-renderer',
            'bili-comment-reply-renderer',
            'bili-comments-header-renderer'
        ]);

        const rootObservers = new Map();       // shadowRoot -> MutationObserver
        const pendingHosts = new Set();        // 已发现但尚未 attachShadow 的宿主
        const threadOriginalDisplay = new WeakMap();
        let applyScheduled = false;

        const scheduleApply = () => {
            if (applyScheduled) return;
            applyScheduled = true;

            queueMicrotask(() => {
                applyScheduled = false;
                applyRules();
            });
        };

        const setImportantStyle = (element, property, value) => {
            if (!element) return;

            if (
                element.style.getPropertyValue(property) !== value ||
                element.style.getPropertyPriority(property) !== 'important'
            ) {
                element.style.setProperty(property, value, 'important');
            }
        };

        const hide = element => setImportantStyle(element, 'display', 'none');

        const observeRoot = (shadowRoot, isHeader = false) => {
            if (rootObservers.has(shadowRoot)) return;

            const observer = new MutationObserver(scheduleApply);

            observer.observe(shadowRoot, {
                childList: true,
                subtree: true,
                attributes: true,
                // Header 的悬浮输入框通过 class/style 切换显示；
                // 评论内容只需关注商品标记。
                attributeFilter: isHeader
                    ? ['class', 'style', 'hidden', 'aria-hidden']
                    : ['data-type']
            });
            rootObservers.set(shadowRoot, observer);
        };

        const setThreadHidden = (thread, hidden) => {
            if (hidden) {
                if (!threadOriginalDisplay.has(thread)) {
                    threadOriginalDisplay.set(thread, {
                        value: thread.style.getPropertyValue('display'),
                        priority: thread.style.getPropertyPriority('display')
                    });
                }
                setImportantStyle(thread, 'display', 'none');
                return;
            }

            const original = threadOriginalDisplay.get(thread);
            if (!original) return;

            if (original.value) {
                thread.style.setProperty('display', original.value, original.priority);
            } else {
                thread.style.removeProperty('display');
            }
            threadOriginalDisplay.delete(thread);
        };

        /*
         * 遍历一条评论（含任意深度 Shadow DOM）：
         * 1. 查找商品标记，有则隐藏整条评论；
         * 2. 隐藏每条评论/回复内的 #footer；
         * 3. 记录尚未 attachShadow 的组件，交给定时器兜底。
         */
        const scanThread = thread => {
            let hasGoods = false;

            const walk = node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (goodsComments && node.matches('[data-type="goods"]')) {
                        hasGoods = true;
                    }

                    const tag = node.localName;
                    const shadowRoot = node.shadowRoot;

                    if (shadowRoot) {
                        observeRoot(shadowRoot);

                        if (
                            commentFooters &&
                            (tag === 'bili-comment-renderer' ||
                             tag === 'bili-comment-reply-renderer')
                        ) {
                            hide(shadowRoot.querySelector('#footer'));
                        }

                        walk(shadowRoot);
                    } else if (SHADOW_COMPONENTS.has(tag)) {
                        pendingHosts.add(node);
                    }
                }

                for (const child of node.children || []) walk(child);
            };

            walk(thread);
            if (goodsComments) setThreadHidden(thread, hasGoods);
        };

        const applyRules = () => {
            const commentsHost = document.querySelector('#commentapp > bili-comments');
            const root = commentsHost && commentsHost.shadowRoot;

            if (!root) {
                if (commentsHost) pendingHosts.add(commentsHost);
                return;
            }

            observeRoot(root);

            if (commentPadding) {
                setImportantStyle(root.querySelector('#contents'), 'padding-top', '0px');
            }

            if (goodsComments || commentFooters) {
                root.querySelectorAll('#feed > bili-comment-thread-renderer')
                    .forEach(scanThread);
            }

            const headerHost = root.querySelector('#header > bili-comments-header-renderer');
            const headerRoot = headerHost && headerHost.shadowRoot;

            if (headerHost && !headerRoot) {
                pendingHosts.add(headerHost);
                return;
            }

            if (headerRoot) {
                observeRoot(headerRoot, commentInput || floatingCommentInput);

                if (navbarMargin) {
                    setImportantStyle(headerRoot.querySelector('#navbar'), 'margin-bottom', '0px');
                }

                if (commentInput) hide(headerRoot.querySelector('#commentbox'));
                if (floatingCommentInput) {
                    hide(headerRoot.querySelector('.bili-comments-bottom-fixed-wrapper'));
                }
            }
        };

        // 新评论、展开回复、翻页、Header 动态节点变化时重新扫描。
        const documentObserver = new MutationObserver(scheduleApply);
        documentObserver.observe(document, { childList: true, subtree: true });

        applyRules();

        // 只检查此前见过、但当时尚未创建 ShadowRoot 的宿主节点。
        const pendingTimer = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;

            let found = false;

            for (const host of pendingHosts) {
                if (!host.isConnected) {
                    pendingHosts.delete(host);
                } else if (host.shadowRoot) {
                    pendingHosts.delete(host);
                    observeRoot(
                        host.shadowRoot,
                        host.localName === 'bili-comments-header-renderer'
                    );
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

    if (currentSite.id === 'bilibili') {
        installBilibiliShadowRules({
            commentPadding: currentSettings.style &&
                isItemEnabled('style', 'bilibili', 'bili-comment-content-padding'),
            navbarMargin: currentSettings.style &&
                isItemEnabled('style', 'bilibili', 'bili-comment-navbar-margin'),
            goodsComments: currentSettings.block &&
                isItemEnabled('block', 'bilibili', 'bili-goods-comments'),
            commentFooters: currentSettings.block &&
                isItemEnabled('block', 'bilibili', 'bili-comment-footers'),
            commentInput: currentSettings.block &&
                isItemEnabled('block', 'bilibili', 'bili-comment-input'),
            floatingCommentInput: currentSettings.block &&
                isItemEnabled('block', 'bilibili', 'bili-floating-comment-input')
        });
    }
})();
