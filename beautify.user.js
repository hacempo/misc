// ==UserScript==
// @name         beautify
// @namespace    http://tampermonkey.net/
// @version      7.17.4
// @description  独立控制指定网站的页面美化与元素屏蔽
// @match        *://tieba.baidu.com/*
// @match        *://*.tieba.baidu.com/*
// @match        *://115.com/*
// @match        *://*.115.com/*
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
// @updateURL    https://raw.githubusercontent.com/hacempo/misc/master/beautify.user.js?v=7.17.4
// @downloadURL  https://raw.githubusercontent.com/hacempo/misc/master/beautify.user.js?v=7.16.1
// @run-at       document-start
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// ==/UserScript==

(function () {
    'use strict';

    /*
     * 站点列表。每个站点的美化与屏蔽分别控制。
     * 所有功能统一从油猴菜单的「设置」入口管理。
     */
    const SITES = [
        { id: 'tieba', name: '百度贴吧', domains: ['tieba.baidu.com'] },
        { id: '115', name: '115 网盘', domains: ['115.com', '115vod.com'] },
        { id: 'nga', name: 'NGA 玩家社区', domains: ['ngabbs.com'] },
        { id: '123pan', name: '123 云盘', domains: ['yun.123pan.cn'] },
        { id: 'zhihu', name: '知乎', domains: ['www.zhihu.com'] },
        { id: 'bilibili', name: '哔哩哔哩', domains: ['bilibili.com'] },
        { id: 'x', name: '推特', domains: ['x.com'] },
        { id: 'douyin', name: '抖音', domains: ['douyin.com'] },
        { id: 'southplus', name: '南+', domains: ['south-plus.net'] },
        { id: 'laowang', name: '老王论坛', domains: ['laowang.vip'] },
        { id: '18comic', name: '禁漫天堂', domains: ['18comic.vip'] },
        { id: 'sehuatang', name: '98 堂', domains: ['sehuatang.net'] },
        { id: 'xsijishe', name: '司机社', domains: ['xsijishe.com'] }
    ];

    const hostname = location.hostname.toLowerCase();
    let pathname = location.pathname;

    const isDomainMatch = domain =>
        hostname === domain || hostname.endsWith('.' + domain);

    const matchesPath = paths =>
        paths.some(path => pathname === path || pathname.startsWith(path + '/'));

    /*
     * 规则是否对当前页面生效。可选字段：
     *   enabled: false      仅保留记录，不生效
     *   domains             限定域名（含子域）
     *   onlyPaths           仅这些路径生效
     *   exactPath           onlyPaths 中路径必须完全相等
     *   exactPaths          精确匹配任一指定路径
     *   onlyPathIncludes    路径包含指定片段时生效
     *   excludePaths        这些路径不生效
     */
    // 仅判断规则的域名/路径上下文；是否启用由每条规则自己的开关决定。
    const matchesRuleRoute = rule => {
        if (rule.exactPaths || rule.onlyPathIncludes) {
            return Boolean(
                rule.exactPaths?.includes(pathname) ||
                rule.onlyPathIncludes?.some(part => pathname.includes(part))
            );
        }
        if (!rule.onlyPaths) return true;
        return rule.exactPath
            ? rule.onlyPaths.includes(pathname)
            : matchesPath(rule.onlyPaths);
    };

    const isRuleActive = rule =>
        (!rule.domains || rule.domains.some(isDomainMatch)) &&
        matchesRuleRoute(rule) &&
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
    let refreshCurrentPageRules = () => {};

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
        ],

        x: [
            {
                // 主内容容器占满视口可用宽度。
                selectors: ['main > :only-child'],
                declarations: { width: '100%', 'max-width': 'none' }
            },
            {
                // 主栏填满主内容容器；max-width:auto 无效，改用 none 并明确设宽度。
                selectors: ['.r-1ye8kvj'],
                declarations: { width: '100%', 'max-width': 'none', 'min-width': '0' }
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
                '#fast_post_c', '#m_nav', '#mainmenu', '#m_pbtntop', '#b_nav', '#footer'
            ]
        },
        {
            // NGA：首页帖子信息行。
            domains: ['ngabbs.com'],
            selectors: ['.posterInfoLine']
        },
        {
            // 老王论坛：评论区提示和用户等级。
            domains: ['laowang.vip'],
            selectors: ['.anti-scam-warning', '.top_lev']
        },
        {
            // 老王论坛：顶部 App 下载提示。
            domains: ['laowang.vip'],
            selectors: ['#close']
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
            // 知乎：侧栏与顶栏入口（顶栏按从左到右排列）
            domains: ['www.zhihu.com'],
            selectors: [
                '.css-bkewaf',
                '.css-18opwoy',
                '.css-79elbk > :first-child',
                '[aria-label="知乎"]',
                '[href="https://www.zhihu.com/column-square"]',
                '[href="https://www.zhihu.com/ring-feeds"]',
                '.css-53paqb',
                '[href="https://www.zhihu.com/project-square"]',
                '[href="https://www.zhihu.com/fiore/h5/vip-web"]',
                '[href="https://zhida.zhihu.com/"]',
                '.SearchBar-askContainer',
                '.css-1vbrp2j',
                '.css-ruapjk'
            ]
        },
        {
            // 知乎非搜索页：回答操作栏第一个按钮（赞同/反对入口）
            domains: ['www.zhihu.com'],
            excludePaths: ['/search'],
            selectors: ['.ContentItem-actions > :first-child']
        },
        {
            // 知乎回答页：问题栏、关注/赞赏，以及回答操作栏后续按钮
            domains: ['www.zhihu.com'],
            selectors: [
                '.QuestionHeader-side',
                '.QuestionHeader-footer',
                '.FollowButton',
                '.Reward',
                '[aria-label="喜欢"]',
                '[data-tooltip="解释这篇内容"]',
                '.WriteArea',
                '.CornerButtonsGroup'
            ]
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
            // X：首页发帖框，仅限 /home，避免误伤帖子详情页。
            domains: ['x.com'],
            onlyPaths: ['/home'],
            exactPath: true,
            selectors: ['[aria-label="主页时间线"] > :nth-child(3)']
        },
        {
            // X：楼主帖子专用操作栏与回复输入框，仅在帖子详情页生效。
            domains: ['x.com'],
            onlyPathIncludes: ['/status/'],
            selectors: [
                'article .r-qklmqi > :first-child',
                '[data-testid="inline_reply_offscreen"]'
            ]
        },
        {
            // X：其他帖子操作栏同时出现在首页信息流和帖子详情页。
            domains: ['x.com'],
            exactPaths: ['/home'],
            onlyPathIncludes: ['/status/'],
            selectors: ['article .r-kzbkwu > :last-child']
        },
        {
            // X：左侧导航与右侧推荐栏。使用 banner header 精确定位左侧栏。
            domains: ['x.com'],
            selectors: ['header[role="banner"]', '[data-testid="sidebarColumn"]']
        },
        {
            // X：帖子详情页评论之间的间隔。
            domains: ['x.com'],
            onlyPathIncludes: ['/status/'],
            selectors: ['.r-ttdzmv']
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
        },
        { domains: ['18comic.vip'], selectors: ['.col-sm-3'] },
        { domains: ['www.bilibili.com'], selectors: ['.video-resource-list'] },
        { domains: ['www.zhihu.com'], selectors: ['.css-140jo2', '.css-dvccr2', '.css-a3pqj1', '.css-kt4t4n'] },
        {
            // 南+移动版：仅 /simple/index.php 下的帖子页、茶馆页和全站元素。
            domains: ['south-plus.net'], onlyPaths: ['/simple/index.php'], exactPath: true,
            selectors: ['.btn-outline-secondary', 'form[name="FORM"]', '.container>center', 'body>center', '.pages', '.by', '.btn-danger', '.blockquote']
        },
        { domains: ['sehuatang.net'], selectors: ['.n5_zdtys>ul'] },
        {
            // xsijishe：帖子楼层信息、输入框、页脚及购买提示。
            domains: ['xsijishe.com'],
            selectors: ['.xxm-reply-meta', '.xxm-ratelog', '.authortitle', '.vtxxmpost', '.footer', '.xxm-bottom', '.xxmgapb', '.jnpar-m-tip', '.mtw']
        },
        {
            // X：首页 App 下载提示。
            domains: ['x.com'], onlyPaths: ['/home'], exactPath: true, selectors: ['.r-494qqr']
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

    const isItemEnabled = (feature, siteId, itemId, defaultEnabled = true) => {
        const key = itemEnabledKey(feature, siteId, itemId);
        const saved = GM_getValue(key, undefined);
        if (typeof saved === 'boolean') return saved;

        // 115 视频并入 115 网盘后，迁移旧站点的单项开关状态。
        if (siteId === '115') {
            const oldKey = itemEnabledKey(feature, '115vod', itemId);
            const oldSaved = GM_getValue(oldKey, undefined);
            if (typeof oldSaved === 'boolean') {
                GM_setValue(key, oldSaved);
                return oldSaved;
            }
        }

        return defaultEnabled;
    };

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
                    path: '全站 > 顶栏 > 固定外层容器',
                    elementName: 'div:has(> header.AppHeader)',
                    effectDescription: '让顶部导航栏与页面内容左右对齐，避免右侧出现横向溢出。'
                }
            ],
            block: []
        },
        bilibili: {
            style: [
                {
                    id: 'bili-comment-content-padding',
                    title: '评论区内容顶部间距',
                    path: '播放 > 评论区 > 内容区',
                    elementName: '#commentapp > bili-comments 的 Shadow DOM 内 #contents',
                    effectDescription: '收紧评论区内容顶部的空白，让评论内容更靠近上方导航。'
                },
                {
                    id: 'bili-comment-navbar-margin',
                    title: '评论区导航栏间距',
                    path: '播放 > 评论区 > 顶部导航栏',
                    elementName: '#commentapp > bili-comments > #header > bili-comments-header-renderer 的 Shadow DOM 内 #navbar',
                    effectDescription: '缩小评论区顶部导航栏下方的空白，让评论列表更紧凑。'
                }
            ],
            block: [
                {
                    id: 'bili-goods-comments',
                    title: '商品标记评论',
                    path: '播放 > 评论区 > 评论',
                    elementName: 'bili-comment-thread-renderer:has([data-type="goods"])',
                    effectDescription: '包含商品推广的评论'
                },
                {
                    id: 'bili-comment-footers',
                    title: '评论操作栏',
                    path: '播放 > 评论区 > 评论',
                    elementName: 'bili-comment-renderer >>> #footer, bili-comment-reply-renderer >>> #footer',
                    effectDescription: '操作栏',
                    positionDescription: '主评论和回复下方'
                },
                {
                    id: 'bili-comment-input',
                    title: '评论输入框',
                    path: '播放 > 评论区 > 顶部输入框',
                    elementName: 'bili-comments-header-renderer >>> #commentbox',
                    effectDescription: '评论框',
                    positionDescription: '评论区顶部'
                },
                {
                    id: 'bili-floating-comment-input',
                    title: '悬浮评论输入框',
                    path: '播放 > 评论区 > 底部悬浮输入框',
                    elementName: 'bili-comments-header-renderer >>> .bili-comments-bottom-fixed-wrapper',
                    effectDescription: '悬浮评论框',
                    positionDescription: '评论区底部'
                }
            ]
        }
    };


    // 美化项的显示名称、目标元素和效果说明；样式规则文本直接由真实 declarations 生成。
    const STYLE_PRESENTATION = {
    "tieba": {
        ".main-page-wrap": {
            "title": "主页主内容容器",
            "element": "贴吧移动端主页的主内容容器 .main-page-wrap",
            "effect": "取消内容容器的最大宽度上限，让页面主体可随可用空间伸展。"
        },
        ".nav-bar-v2-fixed": {
            "title": "固定顶栏容器",
            "element": "贴吧移动端顶部固定导航栏容器 .nav-bar-v2-fixed",
            "effect": "取消导航栏的最大宽度上限，使固定导航栏可使用全部可用宽度。"
        }
    },
    "zhihu": {
        ".Question-main": {
            "title": "问题页主栏容器",
            "element": "知乎问题页的主要内容容器 .Question-main",
            "effect": "让问题页主栏宽度铺满可用区域，清除左右外边距和内边距。"
        },
        ".Question-mainColumn": {
            "title": "回答正文主栏",
            "element": "问题页承载回答正文的主栏 .Question-mainColumn",
            "effect": "让正文主栏作为弹性项目占据剩余空间，并允许其按布局需要收缩。"
        },
        ".css-1gl8cva": {
            "title": "主栏内部容器",
            "element": "问题页主栏内层内容容器 .css-1gl8cva",
            "effect": "让内层内容容器铺满宽度，并清除左右外边距和内边距。"
        },
        ".Topstory-container": {
            "title": "首页内容外层容器",
            "element": "知乎首页信息流外层容器 .Topstory-container",
            "effect": "取消首页外层容器的宽度上限并清除左右内边距。"
        },
        ".Topstory-mainColumn": {
            "title": "首页信息流主栏",
            "element": "知乎首页信息流主栏 .Topstory-mainColumn",
            "effect": "让主栏铺满宽度、允许弹性收缩，并移除右侧外边距。"
        },
        ".Topstory-mainColumnCard": {
            "title": "首页主栏卡片",
            "element": "首页主栏中的内容卡片 .Topstory-mainColumnCard",
            "effect": "让卡片宽度铺满父容器，并取消最大宽度限制。"
        },
        ".Topstory-content": {
            "title": "首页信息流内容区",
            "element": "首页信息流内容容器 .Topstory-content",
            "effect": "让信息流内容区宽度铺满父容器，并取消最大宽度限制。"
        },
        ".Topstory-recommend": {
            "title": "首页推荐内容区",
            "element": "首页推荐内容容器 .Topstory-recommend",
            "effect": "让推荐内容区宽度铺满父容器，并取消最大宽度限制。"
        },
        "div:has(> header.AppHeader)": {
            "title": "顶栏固定外层容器",
            "element": "直接包含 header.AppHeader 的固定定位外层 div",
            "effect": "将固定顶栏外层宽度绑定到 body 的实际宽度，避免使用 100vw 时把滚动条宽度也计算进去而产生横向溢出。"
        },
        "header.AppHeader": {
            "title": "顶栏主容器",
            "element": "知乎顶部导航主容器 header.AppHeader",
            "effect": "让顶栏主容器铺满宽度，并清除左右外边距。"
        },
        "header.AppHeader > div": {
            "title": "顶栏内容内层",
            "element": "header.AppHeader 下的第一层 div 内容容器",
            "effect": "让顶栏内层宽度铺满父容器，同时将最大宽度限制在父容器的 100%。"
        },
        "header.AppHeader > div > .css-51utkw": {
            "title": "顶栏中间导航和搜索区",
            "element": "顶栏内承载导航与搜索的中间区域 .css-51utkw",
            "effect": "通过弹性布局占据顶栏剩余空间；宽度设为 auto，弹性基准为 0%。"
        },
        "header.AppHeader > div > .css-51utkw > .css-51utkw": {
            "title": "顶栏导航内层",
            "element": "顶栏中间区域内部的导航容器 .css-51utkw",
            "effect": "让导航内层铺满父容器，并允许其按内容自然伸展。"
        },
        "header.AppHeader .css-1ndlr1n": {
            "title": "顶栏导航子区域",
            "element": "顶栏中的子区域 .css-1ndlr1n",
            "effect": "将最大宽度限制为父级的 100%，允许宽度收缩，并使用 border-box 计算尺寸。"
        },
        ".css-x84wzl": {
            "title": "顶栏搜索区域",
            "element": "知乎顶栏中的搜索区域 .css-x84wzl",
            "effect": "允许搜索区域收缩并占据导航与头像之间的剩余空间，内部内容靠右排列。"
        },
        ".css-x84wzl .SearchBar": {
            "title": "顶栏搜索框",
            "element": ".css-x84wzl 内的搜索框 .SearchBar",
            "effect": "视口宽度达到 800px 时，将搜索框宽度设为 400px 至 540px 的响应式范围，同时限制其不超过父容器。"
        },
        ".css-x84wzl .SearchBar-tool": {
            "title": "搜索框工具栏",
            "element": "搜索框内部工具栏 .SearchBar-tool",
            "effect": "让搜索工具栏铺满父容器，并将最大宽度限制在父容器的 100%。"
        },
        ".css-14iuq0r": {
            "title": "顶栏左侧区域",
            "element": "知乎顶栏及悬浮顶栏中的左侧区域 .css-14iuq0r",
            "effect": "取消左侧区域的最大宽度上限，避免其被固定宽度约束。"
        },
        ".QuestionHeader": {
            "title": "顶部问题栏容器",
            "element": "问题页顶部问题栏容器 .QuestionHeader",
            "effect": "让问题栏容器宽度铺满可用区域，并清除左右外边距。"
        },
        ".QuestionHeader-content": {
            "title": "问题栏内容区",
            "element": ".QuestionHeader 内的内容容器 .QuestionHeader-content",
            "effect": "让问题栏内容区铺满宽度，并清除左右内边距。"
        },
        ".QuestionHeader-main": {
            "title": "问题栏主内容区",
            "element": ".QuestionHeader 内承载问题标题的主内容区 .QuestionHeader-main",
            "effect": "将问题栏主内容区宽度设为父容器的 100%。"
        },
        ".ContentItem-actions > :nth-child(2)": {
            "title": "回答操作栏第二个按钮",
            "element": ".ContentItem-actions 中从左向右的第二个直接子元素",
            "effect": "将操作栏第二个按钮的左外边距清零，收紧按钮之间的间距。"
        },
        ".ContentItem-actions": {
            "title": "回答操作栏容器",
            "element": "回答卡片底部操作按钮容器 .ContentItem-actions",
            "effect": "将操作栏左右外边距各设为 -16px，使操作栏向两侧扩展 16px。"
        },
        ".css-1qqx3d0 > :nth-child(2)": {
            "title": "搜索结果操作栏第二个按钮",
            "element": ".css-1qqx3d0 中从左向右的第二个直接子元素",
            "effect": "将搜索结果操作栏第二个按钮的左外边距清零，收紧按钮之间的间距。"
        },
        ".css-1qqx3d0": {
            "title": "搜索结果操作栏容器",
            "element": "搜索结果回答卡片的操作栏容器 .css-1qqx3d0",
            "effect": "将操作栏左右外边距各设为 -16px，使操作栏向两侧扩展 16px。"
        },
        ".Search-container": {
            "title": "搜索页外层容器",
            "element": "知乎搜索页面的外层容器 .Search-container",
            "effect": "清除外层容器内边距，并将宽度设为 100%。"
        },
        "#SearchMain": {
            "title": "搜索页主内容区",
            "element": "知乎搜索页面主内容容器 #SearchMain",
            "effect": "清除右外边距，并将主内容区宽度设为 100%。"
        },
        ".SearchTabs-inner": {
            "title": "搜索页悬浮工具栏",
            "element": "搜索页顶部悬浮工具栏内层 .SearchTabs-inner",
            "effect": "改为 flex 布局，清除外边距和最大宽度限制，并让工具栏铺满宽度、垂直居中。"
        },
        ".SearchTabs-searchBarContainer": {
            "title": "搜索页工具栏搜索框",
            "element": "搜索页悬浮工具栏中的搜索框容器 .SearchTabs-searchBarContainer",
            "effect": "将搜索框容器自动推到工具栏右侧，并保持其按内容决定基础宽度。"
        }
    },
    "bilibili": {
        "main": {
            "title": "动态页主内容区",
            "element": "哔哩哔哩动态页的主内容区 main 元素",
            "effect": "让主内容区铺满父容器、清除左右外边距，并跨越网格布局的全部列。"
        }
    },
    "x": {
        "main > :only-child": {
            "title": "X 主内容区域",
            "element": "main 的唯一子元素 main > :only-child",
            "effect": "将主内容区域宽度设为 100%，并取消最大宽度限制。"
        },
        ".r-1ye8kvj": {
            "title": "X 主栏内容容器",
            "element": "X 页面中的主栏内容容器 .r-1ye8kvj",
            "effect": "将主栏宽度设为 100%，取消最大宽度限制并允许其收缩。"
        }
    }
};

    const STYLE_EFFECT_HINTS = {
        tieba: {
            '.main-page-wrap': '让主页内容区域充分利用屏幕宽度。',
            '.nav-bar-v2-fixed': '让顶部导航栏铺满可用宽度。'
        },
        zhihu: {
            '.Question-main': '让问题页主内容区域铺满可用宽度，并收紧内部栏间距。',
            '.Question-mainColumn': '让回答正文区域占据主栏的可用空间。',
            '.css-1gl8cva': '让回答正文内层区域铺满宽度。',
            '.Topstory-container': '让首页内容区域铺满可用宽度。',
            '.Topstory-mainColumn': '让首页信息流主栏扩展到可用宽度。',
            '.Topstory-mainColumnCard': '让首页内容卡片铺满主栏。',
            '.Topstory-content': '让首页信息流内容铺满主栏。',
            '.Topstory-recommend': '让首页推荐内容铺满主栏。',
            'div:has(> header.AppHeader)': '让顶部导航栏与页面内容左右对齐，避免横向溢出。',
            'header.AppHeader': '让顶部导航栏铺满可用宽度。',
            'header.AppHeader > div': '让顶部导航栏内部内容充分利用可用宽度。',
            'header.AppHeader > div > .css-51utkw': '为顶部导航和搜索区域留出充足空间。',
            'header.AppHeader > div > .css-51utkw > .css-51utkw': '让顶部导航内容自然延展，不受多余宽度限制。',
            'header.AppHeader .css-1ndlr1n': '避免顶部导航子区域被挤窄或撑出容器。',
            '.css-x84wzl': '让搜索区域灵活使用导航栏剩余空间，并靠右排列。',
            '.css-x84wzl .SearchBar': '让顶部搜索框在较宽屏幕上保持舒适宽度。',
            '.css-x84wzl .SearchBar-tool': '让搜索框工具区域铺满可用空间。',
            '.css-14iuq0r': '让顶部左侧区域不再受固定宽度限制。',
            '.QuestionHeader': '让问题标题栏铺满可用宽度。',
            '.QuestionHeader-content': '让问题标题栏内容铺满区域。',
            '.QuestionHeader-main': '让问题标题和主要信息充分利用横向空间。',
            '.ContentItem-actions > :nth-child(2)': '收紧回答操作按钮之间的空隙。',
            '.ContentItem-actions': '让回答底部操作栏与卡片内容边缘对齐。',
            '.css-1qqx3d0 > :nth-child(2)': '收紧搜索结果操作按钮之间的空隙。',
            '.css-1qqx3d0': '让搜索结果底部操作栏与卡片内容边缘对齐。',
            '.Search-container': '让搜索页面内容铺满可用宽度。',
            '#SearchMain': '让搜索结果主区域铺满可用宽度。',
            '.SearchTabs-inner': '让搜索页顶部工具栏铺满宽度，内容保持整齐排列。',
            '.SearchTabs-searchBarContainer': '让搜索框靠到顶部工具栏右侧。'
        },
        bilibili: {
            'main': '让动态页主内容区域铺满页面宽度。'
        },
        x: {
            'main > :only-child': '让 X 的主内容区域铺满可用宽度。',
            '.r-1ye8kvj': '让 X 的主栏内容充分利用可用宽度。'
        }
    };

    const getStylePresentation = (siteId, selector, rule) => {
        if (siteId === 'zhihu' && selector === '.Question-main' && rule.declarations.gap !== undefined) {
            return {
                title: '问题页主栏间距',
                element: '知乎问题页的主要内容容器 .Question-main',
                effect: '将主栏内部 gap 和 column-gap 都设为 0，清除主栏内部的列间距。'
            };
        }
        if (siteId === 'zhihu' && selector === '.Question-mainColumn' && rule.declarations.flex !== undefined) {
            return {
                title: '回答正文主栏弹性布局',
                element: '问题页承载回答正文的主栏 .Question-mainColumn',
                effect: '设置 flex: 1 1 0%，让正文主栏占据剩余空间并可随布局收缩。'
            };
        }
        return STYLE_PRESENTATION[siteId]?.[selector] || {
            title: selector,
            element: '匹配选择器 ' + selector + ' 的页面元素',
            effect: '按下方列出的 CSS 属性和值覆盖页面原样式。'
        };
    };

    // 每条规则的可读说明；美化项会自动附加实际选择器与 declarations。
    const RULE_HINTS = {
        style: {
            tieba: {
                '.main-page-wrap': '首页 > 主内容区',
                '.nav-bar-v2-fixed': '全站 > 顶栏 > 固定导航栏'
            },
            zhihu: {
                '.Question-main': '回答页 > 主要内容 > 主栏',
                '.Question-mainColumn': '回答页 > 主要内容 > 正文主栏',
                '.css-1gl8cva': '回答页 > 主要内容 > 主栏内层',
                '.Topstory-container': '首页 > 主要内容 > 外层容器',
                '.Topstory-mainColumn': '首页 > 主要内容 > 主栏',
                '.Topstory-mainColumnCard': '首页 > 主要内容 > 主栏卡片',
                '.Topstory-content': '首页 > 主要内容 > 信息流',
                '.Topstory-recommend': '首页 > 主要内容 > 推荐区域',
                'div:has(> header.AppHeader)': '全站 > 顶栏 > 固定外层容器',
                'header.AppHeader': '全站 > 顶栏 > 主容器',
                'header.AppHeader > div': '全站 > 顶栏 > 内层容器',
                'header.AppHeader > div > .css-51utkw': '全站 > 顶栏 > 中间导航和搜索区',
                'header.AppHeader > div > .css-51utkw > .css-51utkw': '全站 > 顶栏 > 导航内层',
                'header.AppHeader .css-1ndlr1n': '全站 > 顶栏 > 导航子区域',
                '.css-x84wzl': '全站 > 顶栏 > 搜索区域',
                '.css-x84wzl .SearchBar': '全站 > 顶栏 > 搜索框',
                '.css-x84wzl .SearchBar-tool': '全站 > 顶栏 > 搜索工具栏',
                '.css-14iuq0r': '全站 > 顶栏 > 左侧区域',
                '.QuestionHeader': '回答页 > 顶部问题栏 > 容器',
                '.QuestionHeader-content': '回答页 > 顶部问题栏 > 内容区',
                '.QuestionHeader-main': '回答页 > 顶部问题栏 > 主内容区',
                '.ContentItem-actions > :nth-child(2)': '全站 > 主要内容 > 具体回答 > 操作栏 > 第二个按钮',
                '.ContentItem-actions': '全站 > 主要内容 > 具体回答 > 操作栏',
                '.css-1qqx3d0 > :nth-child(2)': '搜索 > 主要内容 > 具体回答 > 操作栏 > 第二个按钮',
                '.css-1qqx3d0': '搜索 > 主要内容 > 具体回答 > 操作栏',
                '.Search-container': '搜索 > 主要内容 > 外层容器',
                '#SearchMain': '搜索 > 主要内容 > 主内容区',
                '.SearchTabs-inner': '搜索 > 顶部 > 悬浮工具栏',
                '.SearchTabs-searchBarContainer': '搜索 > 顶部 > 悬浮工具栏 > 搜索框'
            },
            bilibili: {
                'main': '动态 > 主要内容 > 主栏'
            },
            x: {
                'main > :only-child': '全站 > 主要内容 > 主容器',
                '.r-1ye8kvj': '全站 > 主要内容 > 主栏'
            }
        },
        block: {
            tieba: {
                '.login': '帖子 > 底部 > 悬浮操作栏和回帖点赞',
                '.icon_tshows': '帖子 > 楼主昵称 > 图标',
                '.level-icon': '帖子 > 回帖用户昵称 > 等级图标',
                '.interaction-bar': '首页 > 内容区 > 操作栏'
            },
            '115': {
                '#js_bottom_notification': '网盘 > 底部左侧 > 通知弹窗',
                '.feature-float': '网盘 > 底部右侧 > 悬浮功能弹窗',
                '.container-leftside': '网盘 > 左侧栏',
                '[data-nav="photo"]': '网盘 > 顶栏 > 照片入口',
                '[data-nav="credentials"]': '网盘 > 顶栏 > 密档/证件入口',
                '[data-nav="note"]': '网盘 > 顶栏 > 记事入口',
                '.ceiling-feature': '网盘 > 顶栏中间 > 广告区域',
                '.ceiling-link-temp': '网盘 > 顶栏 > 提示链接/提示条'
            },
            '115vod': {
                '.feature-float': '播放 > 播放器 > 底部右侧 > 悬浮弹窗'
            },
            nga: {
                '.topicrow .c3': '首页 > 帖子列表 > 发帖人和发帖时间',
                '.topicrow .c4': '首页 > 帖子列表 > 最后回帖人和最后回帖时间',
                '.c1': '帖子 > 信息列 > 发帖/回帖总人数、发帖人/回帖人信息',
                '.cell': '帖子 > 单元格 > 搜索框、发表新帖等按钮',
                '#toptopics': '首页 > 版头 > 公告、热帖等聚合区域',
                '#fast_post_c': '帖子 > 快速发帖区',
                '.posterInfoLine': '首页 > 帖子信息',
                '#m_nav': '全站 > 上方导航栏',
                '#mainmenu': '全站 > 顶栏',
                '#m_pbtntop': '帖子页 > 上方翻页栏',
                '#b_nav': '全站 > 下方导航栏',
                '#footer': '全站 > 页脚'
            },
            '123pan': {
                '.notice-box': '网盘 > 底部右侧 > 公告',
                '.entry_p0tlq': '网盘 > 底部右侧 > 广告（公告上方）',
                '.mfy-main-layout__head': '网盘 > 顶部 > 主布局区域',
                'aside': '网盘 > 左侧栏',
                '.withSideMenuLayoutSider_ELJ6a': '网盘 > 主内容区 > 左侧菜单栏'
            },
            zhihu: {
                '.css-bkewaf': '全站 > 主要内容 > 右栏',
                '.css-18opwoy': '全站 > 主要内容 > 具体回答 > 评论区 > 评论 > 回复、点赞',
                '.css-79elbk > :first-child': '全站 > 主要内容 > 具体回答 > 评论区 > 回复栏',
                '[aria-label="知乎"]': '全站 > 顶栏 > Logo',
                '[href="https://www.zhihu.com/column-square"]': '全站 > 顶栏 > 专栏',
                '[href="https://www.zhihu.com/ring-feeds"]': '全站 > 顶栏 > 圈子',
                '.css-53paqb': '全站 > 顶栏 > 分隔符',
                '[href="https://www.zhihu.com/project-square"]': '全站 > 顶栏 > AI Works',
                '[href="https://www.zhihu.com/fiore/h5/vip-web"]': '全站 > 顶栏 > 故事',
                '[href="https://zhida.zhihu.com/"]': '全站 > 顶栏 > 直答',
                '.SearchBar-askContainer': '全站 > 顶栏 > 发布',
                '.css-1vbrp2j': '全站 > 顶栏 > 消息、私信',
                '.css-ruapjk': '全站 > 顶栏 > 头像',
                '.ContentItem-actions > :first-child': '全站 > 主要内容 > 具体回答 > 操作栏 > 赞同/反对',
                '[aria-label="喜欢"]': '全站 > 主要内容 > 具体回答 > 操作栏 > 喜欢',
                '[data-tooltip="解释这篇内容"]': '全站 > 主要内容 > 具体回答 > 操作栏 > 解释',
                '.WriteArea': '首页 > 主要内容 > 写回答（顶部）',
                '.CornerButtonsGroup': '全站 > AI 助手',
                '.QuestionHeader-side': '回答页 > 悬浮顶栏 > 右侧栏',
                '.QuestionHeader-footer': '回答页 > 顶部问题栏 > 底部操作栏',
                '.FollowButton': '回答页 > 关注按钮（多个地方：关注用户、关注问题）',
                '.Reward': '回答页 > 主要内容 > 具体回答 > 赞赏（可能会出现在底部）',
                '.css-1qqx3d0 > :first-child': '搜索 > 主要内容 > 具体回答 > 操作栏 > 赞同/反对',
                '.css-140jo2': '回答 > 评论区 > 评论信息',
                '.css-dvccr2': '回答 > 顶部 > 赞同人数',
                '.css-a3pqj1': '评论页 > 评论框',
                '.css-kt4t4n': '回答 > 评论区 > 悬浮评论框'
            },
            bilibili: {
                '.adblock-tips': '全站 > 页面',
                '.recommended-swipe': '首页 > 信息流',
                '.floor-single-card': '首页 > 信息流',
                '.feed-card:not(:has(.enable-no-interest))': '首页 > 信息流',
                '.bili-feed-card:not(:has(.enable-no-interest))': '首页 > 信息流',
                '.left-entry-main > :nth-child(n+4)': '全站 > 顶栏 > 左侧按钮',
                '.right-entry__main > :not(:nth-child(n+4):nth-child(-n+6))': '全站 > 顶栏 > 右侧按钮',
                'aside': '动态 > 右侧栏',
                '.bili-dyn-publishing': '动态 > 发布区域',
                '.video-resource-list': '视频页 > 推广区域'
            },
            x: {
                '[aria-label="主页时间线"] > :nth-child(3)': '首页 > 输入框',
                'article .r-qklmqi > :first-child': '帖子页 > 楼主帖子 > 操作栏',
                'article .r-kzbkwu > :last-child': '首页/帖子页 > 信息流中的其他帖子 > 操作栏',
                '[data-testid="inline_reply_offscreen"]': '帖子页 > 回复输入框',
                'header[role="banner"]': '全站 > 左栏 > 导航区域',
                '[data-testid="sidebarColumn"]': '全站 > 主要内容 > 右栏',
                '.r-494qqr': '首页 > App 下载提示',
                '.r-ttdzmv': '帖子页 > 评论区 > 评论间隔'
            },
            douyin: {
                '.Ctt1baq8': '评论区 > 评论',
                '.VAQA49VP': '评论区 > 评论',
                '.comment-input-container': '评论区 > 评论框',
                '.semiTabrelated_card': '评论区 > 顶栏',
                '.semiTabai_card': '评论区 > 顶栏'
            },
            southplus: {
                '.btn-outline-secondary': '帖子页 > 楼层 > 回复当前楼层按钮',
                'form[name="FORM"]': '帖子页 > 评论区域',
                '.container>center': '全站 > 底部 > 切换桌面版按钮',
                'body>center': '全站 > 脚注',
                '.pages': '茶馆页 > 顶部翻页栏',
                '.by': '茶馆页 > 信息流 > 帖子 > 帖子信息栏',
                '.btn-danger': '茶馆页 > 顶部路径栏 > 发布主题按钮',
                '.blockquote': '帖子页 > 带资源楼层 > 购买警告'
            },
            laowang: {
                '.anti-scam-warning': '帖子页 > 楼层',
                '.top_lev': '帖子页 > 楼层',
                '#close': '全站 > 顶部 > App 下载提示'
            },
            '18comic': { '.col-sm-3': '全站 > 页面 > 广告栏' },
                sehuatang: { '.n5_zdtys>ul': '综合讨论区页 > 通知区域' },
            xsijishe: {
                '.xxm-reply-meta': '帖子页 > 楼层',
                '.xxm-ratelog': '帖子页 > 楼层',
                '.authortitle': '帖子页 > 楼层 > 用户栏',
                '.vtxxmpost': '帖子页 > 输入框',
                '.footer': '全站 > 页脚',
                '.xxm-bottom': '全站 > 页脚',
                '.xxmgapb': '全站 > 页脚',
                '.jnpar-m-tip': '帖子页 > 楼层',
                '.mtw': '帖子页 > 楼主楼层'
            }
        },
        meaning: {
            tieba: {
                '.login': '登录提示',
                '.icon_tshows': '楼主标识图标',
                '.level-icon': '用户等级图标',
                '.interaction-bar': '内容操作栏'
            },
            '115': {
                '#js_bottom_notification': '底部通知弹窗',
                '.feature-float': '悬浮功能弹窗',
                '.container-leftside': '左侧栏',
                '[data-nav="photo"]': '照片入口',
                '[data-nav="credentials"]': '密档和证件入口',
                '[data-nav="note"]': '记事入口',
                '.ceiling-feature': '顶部推广区域',
                '.ceiling-link-temp': '顶部提示链接'
            },
            '115vod': {
                '.feature-float': '悬浮弹窗'
            },
            nga: {
                '.topicrow .c3': '发帖人和发帖时间',
                '.topicrow .c4': '最后回复人和回复时间',
                '.c1': '帖子人数统计及用户信息',
                '.cell': '功能按钮单元格',
                '#toptopics': '公告和热门话题区域',
                '#fast_post_c': '快速发帖区域',
                '.posterInfoLine': '发帖人、发帖时间及最后回复信息',
                '#m_nav': '导航栏', '#mainmenu': '主菜单', '#m_pbtntop': '翻页栏',
                '#b_nav': '导航栏', '#footer': '页脚'
            },
            '123pan': {
                '.notice-box': '公告',
                '.entry_p0tlq': '推广内容',
                '.mfy-main-layout__head': '顶部主区域',
                'aside': '左侧栏',
                '.withSideMenuLayoutSider_ELJ6a': '侧边菜单'
            },
            zhihu: {
                '.css-bkewaf': '右侧栏',
                '.css-18opwoy': '评论中的回复和点赞区域',
                '.css-79elbk > :first-child': '评论回复框',
                '[aria-label="知乎"]': '知乎 Logo',
                '[href="https://www.zhihu.com/column-square"]': '专栏入口',
                '[href="https://www.zhihu.com/ring-feeds"]': '圈子入口',
                '.css-53paqb': '导航分隔线',
                '[href="https://www.zhihu.com/project-square"]': 'AI Works 入口',
                '[href="https://www.zhihu.com/fiore/h5/vip-web"]': '故事入口',
                '[href="https://zhida.zhihu.com/"]': '直答入口',
                '.SearchBar-askContainer': '发布入口',
                '.css-1vbrp2j': '消息和私信入口',
                '.css-ruapjk': '头像入口',
                '.ContentItem-actions > :first-child': '回答赞同和反对按钮',
                '[aria-label="喜欢"]': '喜欢按钮',
                '[data-tooltip="解释这篇内容"]': '解释按钮',
                '.WriteArea': '写回答区域',
                '.CornerButtonsGroup': 'AI 助手',
                '.QuestionHeader-side': '问题栏右侧区域',
                '.QuestionHeader-footer': '问题栏底部操作区',
                '.FollowButton': '关注按钮',
                '.Reward': '赞赏入口',
                '.css-1qqx3d0 > :first-child': '搜索结果赞同和反对按钮',
                '.css-140jo2': '评论发布时间和地点',
                '.css-dvccr2': '文章赞同人数',
                '.css-a3pqj1': '评论框',
                '.css-kt4t4n': '悬浮评论框'
            },
            bilibili: {
                '.adblock-tips': '检测到广告屏蔽器的提示',
                '.recommended-swipe': '首页轮播推荐内容',
                '.floor-single-card': '分区推广卡片',
                '.feed-card:not(:has(.enable-no-interest))': '初始加载的推广卡片',
                '.bili-feed-card:not(:has(.enable-no-interest))': '下滑加载的推广卡片',
                '.left-entry-main > :nth-child(n+4)': '顶栏左侧按钮（保留前 3 项）',
                '.right-entry__main > :not(:nth-child(n+4):nth-child(-n+6))': '顶栏右侧按钮（保留第 4 至第 6 项）',
                'aside': '动态页右侧栏',
                '.bili-dyn-publishing': '动态发布区域',
                '.video-resource-list': '视频推广'
            },
            x: {
                '[aria-label="主页时间线"] > :nth-child(3)': '发帖输入区域',
                'article .r-qklmqi > :first-child': '楼主帖子的操作栏',
                'article .r-kzbkwu > :last-child': '其他帖子的操作栏',
                '[data-testid="inline_reply_offscreen"]': '回复输入框',
                'header[role="banner"]': '左侧导航栏',
                '[data-testid="sidebarColumn"]': '右侧推荐栏',
                '.r-ttdzmv': '评论之间的空隙',
                '.r-494qqr': 'App 下载提示条'
            },
            douyin: {
                '.Ctt1baq8': '操作栏',
                '.VAQA49VP': '发布时间和发布地区',
                '.comment-input-container': '评论框',
                '.semiTabrelated_card': '切换推荐',
                '.semiTabai_card': '切换 AI'
            },
            southplus: {
                '.btn-outline-secondary': '回复当前楼层按钮',
                'form[name="FORM"]': '评论内容',
                '.container>center': '切换桌面版按钮',
                'body>center': '脚注',
                '.pages': '顶部翻页栏',
                '.by': '帖子发布时间等信息',
                '.btn-danger': '发布主题按钮',
                '.blockquote': '资源购买警告'
            },
            laowang: {
                '.anti-scam-warning': '防诈骗警告', '.top_lev': '用户等级', '#close': 'App 下载提示'
            },
            '18comic': { '.col-sm-3': '广告栏' },
                sehuatang: { '.n5_zdtys>ul': '通知' },
            xsijishe: {
                '.xxm-reply-meta': '发帖时间、点赞、点踩',
                '.xxm-ratelog': '评分信息',
                '.authortitle': '用户等级',
                '.vtxxmpost': '输入框',
                '.footer': '页脚',
                '.xxm-bottom': '',
                '.xxmgapb': '间隔',
                '.jnpar-m-tip': '购买提示',
                '.mtw': '观看人数'
            },
         },
        position: {
            southplus: { '.btn-danger': '右上角' },
            bilibili: { '.recommended-swipe': '左上角' },
            xsijishe: { '.xxm-bottom': '页脚下方', '.xxmgapb': '页脚下方' },
            zhihu: { '.CornerButtonsGroup': '右下角' },
            douyin: {
                '.Ctt1baq8': '底部',
                '.VAQA49VP': '底部，操作栏上方',
                '.comment-input-container': '底部'
            }
        },
        kind: {
            bilibili: {
                '.adblock-tips': '区域',
                '.recommended-swipe': '区域',
                '.floor-single-card': '区域',
                '.feed-card:not(:has(.enable-no-interest))': '区域',
                '.bili-feed-card:not(:has(.enable-no-interest))': '区域',
                '.left-entry-main > :nth-child(n+4)': '按钮',
                '.right-entry__main > :not(:nth-child(n+4):nth-child(-n+6))': '按钮'
            },
            douyin: {
                '.semiTabrelated_card': '按钮',
                '.semiTabai_card': '按钮'
            },
            southplus: {
                '.btn-outline-secondary': '按钮', 'form[name="FORM"]': '区域',
                '.container>center': '按钮', 'body>center': '区域',
                '.pages': '区域', '.by': '区域', '.btn-danger': '按钮', '.blockquote': '区域'
            },
            sehuatang: { '.n5_zdtys>ul': '区域' },
            xsijishe: {
                '.xxm-reply-meta': '区域', '.xxm-ratelog': '区域', '.authortitle': '区域',
                '.vtxxmpost': '区域', '.footer': '区域', '.xxm-bottom': '区域',
                '.xxmgapb': '区域', '.jnpar-m-tip': '区域', '.mtw': '区域'
            }
        }
    };



    const DISPLAY_ONLY_RULES = [
        {
            id: 'southplus-quote-display-only', siteId: 'southplus', selector: '.quote',
            path: '帖子页 > 楼层 > 资源信息区域',
            elementName: '资源售价和购买人数信息',
            effectDescription: '资源信息区域（仅展示，暂不屏蔽，避免影响资源购买）',
            pages: ['post']
        },
        {
            id: 'xsijishe-signature-display-only', siteId: 'xsijishe',
            selector: "div[style=\"font-size: 12px;overflow: hidden;margin-top: 15px;padding-top: 12px;line-height: 1.6;background: url('static/image/common/sigline.gif') no-repeat 0 0;max-height:550px;\"]",
            path: '帖子页 > 楼层 > 用户栏 > 签名',
            elementName: '用户签名区域',
            effectDescription: '用户签名区域（规则尚未完善，仅展示，不启用）',
            pages: ['post']
        }
    ];

    // 设置界面中的页面分类。没有细分页面的站点保留一个总览页签。
    // 设置界面中的页面分类。
    const SITE_PAGES = {
        tieba: [
            { id: 'global', label: '全站' }, { id: 'home', label: '首页' },
            { id: 'thread', label: '帖子' }
        ],
        '115': [
            { id: 'global', label: '全站' },
            { id: 'cloud', label: '网盘' },
            { id: 'play', label: '播放' }
        ],
        nga: [
            { id: 'global', label: '全站' },
            { id: 'home', label: '首页' },
            { id: 'detail', label: '帖子' }
        ],
        '123pan': [
            { id: 'cloud', label: '网盘' }
        ],
        zhihu: [
            { id: 'global', label: '全站' },
            { id: 'home', label: '首页' },
            { id: 'question', label: '回答' },
            { id: 'search', label: '搜索' }
        ],
        bilibili: [
            { id: 'global', label: '全站' },
            { id: 'home', label: '首页' },
            { id: 'video', label: '播放' },
            { id: 'dynamic', label: '动态' }
        ],
        x: [
            { id: 'global', label: '全站' },
            { id: 'home', label: '首页' },
            { id: 'post', label: '帖子' }
        ],
        douyin: [
            { id: 'home', label: '首页' }
        ],
        southplus: [
            { id: 'global', label: '全站' }, { id: 'home', label: '首页' },
            { id: 'tea', label: '茶馆' }, { id: 'post', label: '帖子' }
        ],
        sehuatang: [{ id: 'discussion', label: '综合讨论区' }],
        xsijishe: [{ id: 'global', label: '全站' }, { id: 'post', label: '帖子' }],
        laowang: [{ id: 'global', label: '全站' }, { id: 'post', label: '帖子页' }]
    };

    /*
     * 规则所属页面。未标记的规则视为该站点所有页面通用。
     * 115.com 与 115vod.com 共用「115 网盘」网站设置，但各自落在网盘/播放页签。
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
            '115': {
                '#js_bottom_notification': ['cloud'],
                '.feature-float': ['cloud'],
                '.container-leftside': ['cloud'],
                '[data-nav="photo"]': ['cloud'],
                '[data-nav="credentials"]': ['cloud'],
                '[data-nav="note"]': ['cloud'],
                '.ceiling-feature': ['cloud'],
                '.ceiling-link-temp': ['cloud']
            },
            '115vod': {
                '.feature-float': ['play']
            },
            nga: {
                '.topicrow .c3': ['home'],
                '.topicrow .c4': ['home'],
                '.c1': ['home', 'detail'],
                '.cell': ['home', 'detail'],
                '#toptopics': ['home'],
                '#fast_post_c': ['home', 'detail'],
                '.posterInfoLine': ['home']
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
                '.CornerButtonsGroup': ['home', 'question'],
                '.css-140jo2': ['question'], '.css-dvccr2': ['question'],
                '.css-a3pqj1': ['question'], '.css-kt4t4n': ['question']
            },
            bilibili: {
                '.recommended-swipe': ['home'],
                '.floor-single-card': ['home'],
                '.feed-card:not(:has(.enable-no-interest))': ['home'],
                '.bili-feed-card:not(:has(.enable-no-interest))': ['home'],
                '.video-resource-list': ['video'],
                'aside': ['dynamic'],
                '.bili-dyn-publishing': ['dynamic']
            },
              x: {
                '[aria-label="主页时间线"] > :nth-child(3)': ['home'],
                'article .r-qklmqi > :first-child': ['post'],
                'article .r-kzbkwu > :last-child': ['home', 'post'],
                '[data-testid="inline_reply_offscreen"]': ['post'],
                '.r-ttdzmv': ['post'],
                '.r-494qqr': ['home']
            },
            southplus: {
                '.btn-outline-secondary': ['post'], 'form[name="FORM"]': ['post'],
                '.container>center': ['global'], 'body>center': ['global'],
                '.pages': ['tea'], '.by': ['tea'], '.btn-danger': ['tea'], '.blockquote': ['post']
            },
            sehuatang: { '.n5_zdtys>ul': ['discussion'] },
            xsijishe: {
                '.xxm-reply-meta': ['post'], '.xxm-ratelog': ['post'], '.authortitle': ['post'],
                '.vtxxmpost': ['post'], '.footer': ['global'], '.xxm-bottom': ['global'],
                '.xxmgapb': ['global'], '.jnpar-m-tip': ['post'], '.mtw': ['post']
            },
            laowang: {
                '.anti-scam-warning': ['post'], '.top_lev': ['post'], '#close': ['global']
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

    const getRulePages = (site, feature, ruleKey, isSpecial = false, ruleSiteId = site.id) => {
        const contentPageIds = (SITE_PAGES[site.id] || [{ id: 'all', label: '全部' }])
            .map(page => page.id)
            .filter(pageId => pageId !== 'global');
        const map = isSpecial
            ? RULE_PAGE_MAP.special?.[feature]?.[site.id]
            : RULE_PAGE_MAP[feature]?.[ruleSiteId];
        const mappedPages = map?.[ruleKey];
        if (mappedPages?.length > 1 || (!mappedPages && contentPageIds.length > 1)) {
            return ['global'];
        }
        return mappedPages || contentPageIds;
    };

    const ruleItemId = (feature, rule, selector) => {
        const identity = JSON.stringify({
            selector,
            domains: rule.domains || [],
            onlyPaths: rule.onlyPaths || [],
            excludePaths: rule.excludePaths || [],
            onlyPathIncludes: rule.onlyPathIncludes,
            media: rule.media || '',
            declarations: rule.declarations || null,
            enabled: rule.enabled !== false
        });
        return 'rule-' + hashRuleIdentity(feature + ':' + identity);
    };

    const getSiteRuleItems = site => {
        const style = (STYLE_RULES[site.id] || []).flatMap(rule =>
            rule.selectors.map(selector => {
                const presentation = getStylePresentation(site.id, selector, rule);
                return {
                    id: ruleItemId('style', rule, selector),
                    feature: 'style',
                    title: selector,
                    path: RULE_HINTS.style[site.id]?.[selector] || '其他 > 位置待补充',
                    elementName: selector,
                    effectDescription: STYLE_EFFECT_HINTS[site.id]?.[selector] ||
                        '让该区域更充分利用页面空间，减少不必要的布局限制。' +
                        (rule.media ? '（较宽屏幕下生效）' : ''),
                    pages: getRulePages(site, 'style', selector),
                    detail: '',
                    rule,
                    selector,
                    defaultEnabled: rule.enabled !== false
                };
            })
        );

        const block = BLOCK_RULES
            .filter(rule => !rule.domains || rule.domains.some(domain =>
                site.domains.some(siteDomain =>
                    siteDomain === domain ||
                    siteDomain.endsWith('.' + domain) ||
                    domain.endsWith('.' + siteDomain)
                )
            ))
            .flatMap(rule => {
                const ruleSiteId = rule.domains?.includes('115vod.com') ? '115vod' : site.id;
                return rule.selectors.map(selector => {
                    const path = RULE_HINTS.block[ruleSiteId]?.[selector] ||
                        '其他 > 位置待补充';
                    const pathLeaf = path.split(' > ').map(segment => segment.trim()).filter(Boolean).pop();
                    return {
                        id: ruleItemId('block', rule, selector),
                        feature: 'block',
                        title: selector,
                        path,
                        elementName: selector,
                        effectDescription: (RULE_HINTS.meaning?.[ruleSiteId]?.[selector] ||
                            ((RULE_HINTS.position?.[ruleSiteId]?.[selector] || RULE_HINTS.kind?.[ruleSiteId]?.[selector])
                                ? ''
                                : (pathLeaf && pathLeaf !== '位置待补充' ? pathLeaf : '元素'))) +
                            (rule.media ? '（平板竖屏）' : ''),
                        positionDescription: RULE_HINTS.position?.[ruleSiteId]?.[selector] || '',
                        kindDescription: RULE_HINTS.kind?.[ruleSiteId]?.[selector] || '',
                        pages: getRulePages(site, 'block', selector, false, ruleSiteId),
                        detail: '',
                        rule,
                        selector,
                        defaultEnabled: rule.enabled !== false
                    };
                });
            });

        const displayOnlyBlock = DISPLAY_ONLY_RULES
            .filter(item => item.siteId === site.id)
            .map(item => ({
                ...item, feature: 'block', title: item.elementName,
                defaultEnabled: false, displayOnly: true,
                rule: { domains: site.domains, enabled: false }
            }));

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
            block: [...block, ...displayOnlyBlock, ...special.block.map(item => ({
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
            '.right-panel{min-width:0;min-height:0;display:flex;flex-direction:column;}',
            '.right-panel .pagebar{flex:0 0 auto;}',
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
            '.path-group{border-bottom:1px solid #f0f2f6;}',
            '.path-group:last-child{border-bottom:0;}',
            '.path-summary{display:flex;align-items:center;gap:9px;padding:11px 0;color:#4c5d74;font-size:13px;font-weight:700;cursor:pointer;list-style:none;}',
            '.path-summary::-webkit-details-marker{display:none;}',
            '.path-summary::before{content:"›";display:inline-block;color:#8492a7;font-size:18px;line-height:1;transform:rotate(0deg);transition:transform .15s ease;}',
            '.path-group[open]>.path-summary::before{transform:rotate(90deg);}',
            '.path-count{margin-left:auto;color:#9aa5b5;font-size:11px;font-weight:500;}',
            '.path-depth-1>.path-summary{font-size:12px;color:#718097;}',
            '.path-depth-2>.path-summary{font-size:12px;color:#8793a5;}',
            '.path-rule-list{padding:0 0 4px 24px;}',
            '.group{background:#fff;border:1px solid #e5e9f0;border-radius:13px;overflow:hidden;box-shadow:0 3px 12px rgba(24,39,65,.035);}',
            '.group-head{display:flex;align-items:center;gap:14px;padding:17px 20px;border-bottom:1px solid #edf0f4;}',
            '.group-heading{min-width:0;flex:1;}',
            '.group-title{font-size:16px;font-weight:750;color:#263247;}',
            '.group-desc{margin-top:2px;font-size:12px;color:#8a95a5;}',
            '.group-count{margin-right:6px;color:#98a2b1;font-size:12px;white-space:nowrap;}',
            '.master-toggle{display:flex;align-items:center;gap:7px;color:#536176;font-size:12px;white-space:nowrap;cursor:pointer;}',
            '.switch{width:34px;height:19px;accent-color:#2868cf;cursor:pointer;}',
            '.rule-list{padding:4px 20px;}',
            '.rule-row{min-height:54px;display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid #f0f2f6;}',
            '.rule-row:last-child{border-bottom:0;}',
            '.rule-info{min-width:0;flex:1;}',
            '.rule-details{display:grid;gap:5px;}',
            '.rule-selector{min-width:0;color:#929cac;font-size:11px;line-height:1.4;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;}',
            '.rule-description{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;}',
            '.rule-detail-line{min-width:0;color:#34445d;font-size:13px;font-weight:550;line-height:1.5;overflow-wrap:anywhere;}',
            '.rule-position{display:inline-flex;align-items:center;padding:2px 7px;border-radius:6px;background:#f1f4f8;color:#778397;font-size:11px;line-height:1.5;white-space:nowrap;}',
            '.pending-badge{display:inline-block;margin-left:7px;padding:1px 6px;border-radius:5px;background:#fff2d6;color:#95600c;font-size:10px;font-weight:700;vertical-align:1px;}',
            '.rule-detail{margin-top:4px;color:#929cac;font-size:10px;overflow-wrap:anywhere;}',
            '.archive-content{margin:0;padding:16px 20px;max-height:520px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f9fb;color:#34445d;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;}',
            '.rule-toggle{flex:0 0 auto;width:18px;height:18px;accent-color:#2868cf;cursor:pointer;}',
            '.empty{padding:22px 0;color:#a0a9b6;font-size:13px;}',
            '.master-off .rule-list{opacity:.65;}',
            '.footer-note{margin:18px 2px 0;color:#98a2b1;font-size:12px;}',
            '@media(max-width:700px){.shell{width:calc(100vw - 16px);height:calc(100dvh - 24px);border-radius:12px;}.topbar{padding:0 14px;gap:10px;}.pagebar{min-height:48px;padding:0 10px;gap:4px;}.page-tab{padding:8px 11px;font-size:12px;}.save-hint{display:none;}.content{grid-template-columns:116px minmax(0,1fr);}.sidebar{padding:18px 7px;}.site-button{padding:9px 7px;font-size:12px;}.site-count{display:none;}.main{padding:18px 12px 36px;}.group-head{padding:14px 12px;gap:7px;}.rule-list{padding:4px 12px;}.path-rule-list{padding-left:12px;}.path-summary{padding:9px 0;}.master-toggle{gap:3px;font-size:11px;}.group-count{display:none;}}'
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
        const saveHint = makeElement('div', 'save-hint', '开关修改后会立即生效');
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
        const rightPanel = makeElement('section', 'right-panel');
        rightPanel.append(pagebar);
        const main = makeElement('main', 'main');
        const mainInner = makeElement('div', 'main-inner');
        main.append(mainInner);
        rightPanel.append(main);
        contentArea.append(sidebar, rightPanel);
        shell.append(topbar, contentArea);
        root.append(style, shell);

        function closeSettings() {
            window.removeEventListener('keydown', onKeyDown);
            if (host.parentNode) host.parentNode.removeChild(host);
            if (settingsHost === host) settingsHost = null;
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') closeSettings();
        }

        const updateSavedHint = site => {
            saveHint.textContent = site && currentSite?.id === site.id
                ? '已自动保存 · 当前页面立即生效'
                : '已自动保存 · 进入对应网站时生效';
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

        const makeRuleRow = (site, feature, item) => {
            const row = makeElement('div', 'rule-row');
            const info = makeElement('div', 'rule-info');
            const details = makeElement('div', 'rule-details');
            const description = makeElement('div', 'rule-description');
            if (item.effectDescription) {
                description.append(makeElement('div', 'rule-detail-line', item.effectDescription));
            }
            if (item.path) {
                description.append(makeElement('div', 'rule-detail-line', '路径：' + item.path));
            }
            if (item.positionDescription) {
                description.append(makeElement('span', 'rule-position', '⌖ ' + item.positionDescription));
            }
            if (item.kindDescription) {
                description.append(makeElement('span', 'rule-position', item.kindDescription));
            }
            if (item.displayOnly) {
                description.append(makeElement('span', 'pending-badge', '仅展示 · 不启用'));
            }
            details.append(description);
            details.append(makeElement('div', 'rule-selector', item.selector || item.elementName || '元素位置待补充'));
            info.append(details);

            if (item.displayOnly) {
                row.append(info);
                return row;
            }

            const checkbox = makeElement('input', 'rule-toggle');
            checkbox.type = 'checkbox';
            checkbox.checked = isItemEnabled(feature, site.id, item.id, item.defaultEnabled);
            checkbox.title = '启用或关闭此项';
            checkbox.setAttribute('aria-label', (checkbox.checked ? '关闭' : '开启') + item.title);
            checkbox.addEventListener('change', () => {
                GM_setValue(itemEnabledKey(feature, site.id, item.id), checkbox.checked);
                checkbox.setAttribute('aria-label', (checkbox.checked ? '关闭' : '开启') + item.title);
                if (currentSite?.id === site.id) refreshCurrentPageRules();
                updateSavedHint(site);
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
                    if (currentSite?.id === site.id && currentSettings) {
                        currentSettings[feature] = enabled;
                        refreshCurrentPageRules();
                    }
                    updateSavedHint(site);
                },
                '全站总开关'
            );

            head.append(heading, count, master.label);

            const list = makeElement('div', 'rule-list');
            const pathTree = { children: new Map(), items: [] };

            for (const item of items) {
                if (feature === 'style') {
                    const segments = (item.path || '其他 > 位置待补充')
                        .split(' > ')
                        .map(segment => segment.trim())
                        .filter(Boolean);

                    let node = pathTree;
                    for (const segment of segments) {
                        if (!node.children.has(segment)) {
                            node.children.set(segment, { children: new Map(), items: [] });
                        }
                        node = node.children.get(segment);
                    }
                    node.items.push(item);
                } else {
                    const segments = (item.path || item.description || '其他 > 位置待补充')
                        .split(' > ')
                        .map(segment => segment.trim())
                        .filter(Boolean);

                    if (segments[0] === '通用') segments.shift();

                    const groupSegments = segments.slice(0, -1);
                    let node = pathTree;
                    for (const segment of groupSegments) {
                        if (!node.children.has(segment)) {
                            node.children.set(segment, { children: new Map(), items: [] });
                        }
                        node = node.children.get(segment);
                    }
                    node.items.push(item);
                }
            }

            const renderPathNode = (pathName, node, depth = 0) => {
                const details = makeElement('details', 'path-group path-depth-' + depth);
                details.open = true;

                const summary = makeElement('summary', 'path-summary');
                const countPathItems = current =>
                    current.items.length +
                    [...current.children.values()].reduce(
                        (sum, child) => sum + countPathItems(child), 0
                    );
                const total = countPathItems(node);
                summary.append(
                    makeElement('span', '', pathName),
                    makeElement('span', 'path-count', total + ' 项')
                );

                const body = makeElement('div', 'path-rule-list');
                for (const item of node.items) body.append(makeRuleRow(site, feature, item));
                for (const [childName, childNode] of node.children) {
                    body.append(renderPathNode(childName, childNode, depth + 1));
                }

                details.append(summary, body);
                return details;
            };

            for (const [pathName, node] of pathTree.children) {
                list.append(renderPathNode(pathName, node));
            }
            for (const item of pathTree.items) list.append(makeRuleRow(site, feature, item));

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

            if (visibleStyle.length) groups.append(renderGroup(
                site, 'style', '页面美化', '当前页面的布局、宽度和间距调整。', visibleStyle));
            if (visibleBlock.length) groups.append(renderGroup(
                site, 'block', '元素屏蔽', '当前页面各位置的元素规则。', visibleBlock));
            if (!visibleStyle.length && !visibleBlock.length) {
                groups.append(makeElement('div', 'empty', '这个页面暂时没有美化或屏蔽规则。'));
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
            selectedSite = site;
            currentName.textContent = site.name;
            pagebar.replaceChildren();

            const allPages = getPages(site);
            const pages = allPages.filter(page => getPageRuleCounts(site, page.id) > 0);
            const rememberedPage = selectedPageBySite.get(site.id);
            const initialPageId = pages.some(page => page.id === rememberedPage)
                ? rememberedPage
                : (pages[0]?.id || allPages[0].id);

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
            const total = items.style.length + items.block.length + (site.id === 'tieba' ? 2 : 0);
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

    if (!currentSite) return;

    const buildStyleRule = rule => {
        const declarations = Object.entries(rule.declarations)
            .map(([property, value]) => `    ${property}: ${value} !important;`)
            .join('\n');
        const body = `${rule.selectors.join(',\n')} {\n${declarations}\n}`;
        return rule.media ? `@media ${rule.media} {\n${body}\n}` : body;
    };

    const currentRuleItems = allSiteRuleItems.get(currentSite.id);
    let injectedStyle = null;
    let styleAttachObserver = null;
    let syncZhihuContentWidth = () => {};
    let syncBilibiliRules = () => {};

    const mountStyle = css => {
        if (!css) {
            if (injectedStyle?.parentNode) injectedStyle.parentNode.removeChild(injectedStyle);
            injectedStyle = null;
            if (styleAttachObserver) {
                styleAttachObserver.disconnect();
                styleAttachObserver = null;
            }
            return;
        }
        if (!injectedStyle) {
            injectedStyle = document.createElement('style');
            injectedStyle.id = 'beautify-style';
        }
        injectedStyle.textContent = css;

        const attach = () => {
            const target = document.head || document.documentElement;
            if (target && injectedStyle && injectedStyle.parentNode !== target) {
                target.appendChild(injectedStyle);
            }
            return Boolean(document.head);
        };
        if (attach()) {
            if (styleAttachObserver) {
                styleAttachObserver.disconnect();
                styleAttachObserver = null;
            }
        } else if (!styleAttachObserver) {
            styleAttachObserver = new MutationObserver(() => {
                if (!attach()) return;
                styleAttachObserver.disconnect();
                styleAttachObserver = null;
            });
            styleAttachObserver.observe(document, { childList: true, subtree: true });
        }
    };

    refreshCurrentPageRules = () => {
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
                    !item.displayOnly &&
                    isRuleActive(item.rule) &&
                    isItemEnabled('block', currentSite.id, item.id, item.defaultEnabled)
                )
                .map(item => {
                    const ruleCss = `${item.selector} {\n    display: none !important;\n}`;
                    return item.rule.media ? `@media ${item.rule.media} {\n${ruleCss}\n}` : ruleCss;
                })
            : [];

        mountStyle([...styleCss, ...blockCss].join('\n\n'));
        syncZhihuContentWidth();
        syncBilibiliRules();
    };


    /* =====================================================================
     * 知乎：动态设置顶栏宽度变量；开关关闭时清除观察器和变量。
     * ===================================================================== */

    let zhihuWidthResizeObserver = null;
    let zhihuWidthBodyObserver = null;

    syncZhihuContentWidth = () => {
        if (currentSite.id !== 'zhihu') return;
        const enabled = currentSettings.style &&
            isItemEnabled('style', 'zhihu', 'zhihu-header-width');

        if (!enabled) {
            if (zhihuWidthResizeObserver) {
                zhihuWidthResizeObserver.disconnect();
                zhihuWidthResizeObserver = null;
            }
            if (zhihuWidthBodyObserver) {
                zhihuWidthBodyObserver.disconnect();
                zhihuWidthBodyObserver = null;
            }
            document.documentElement.style.removeProperty('--beautify-content-width');
            return;
        }

        const update = () => {
            if (!document.body) return;
            const width = document.body.getBoundingClientRect().width;
            if (width > 0) {
                document.documentElement.style.setProperty('--beautify-content-width', width + 'px');
            }
        };
        const attach = () => {
            if (!document.body) return false;
            if (!zhihuWidthResizeObserver) {
                zhihuWidthResizeObserver = new ResizeObserver(update);
                zhihuWidthResizeObserver.observe(document.body);
            }
            update();
            return true;
        };

        if (!attach() && !zhihuWidthBodyObserver) {
            zhihuWidthBodyObserver = new MutationObserver(() => {
                if (!attach()) return;
                zhihuWidthBodyObserver.disconnect();
                zhihuWidthBodyObserver = null;
            });
            zhihuWidthBodyObserver.observe(document.documentElement, { childList: true });
        }
    };


    /* =====================================================================
     * Bilibili 评论区（Shadow DOM，普通 CSS 无法穿透，只能用 JS 处理）
     *
     * #commentapp > bili-comments 的 shadowRoot
     *   ├─ #contents
     *   ├─ #feed > bili-comment-thread-renderer
     *   └─ #header > bili-comments-header-renderer 的 shadowRoot
     *        └─ #navbar、#commentbox、悬浮输入框
     * ===================================================================== */

    const installBilibiliShadowRules = initialRules => {
        if (hostname !== 'www.bilibili.com') return () => {};
        let liveRules = { ...initialRules };

        const SHADOW_COMPONENTS = new Set([
            'bili-comments',
            'bili-comment-thread-renderer',
            'bili-comment-renderer',
            'bili-comment-replies-renderer',
            'bili-comment-reply-renderer',
            'bili-comments-header-renderer'
        ]);
        const rootObservers = new Map();
        const pendingHosts = new Set();
        const originalStyles = new WeakMap();
        let applyScheduled = false;

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
                    priority: element.style.getPropertyPriority(property)
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
                    : ['data-type']
            });
            rootObservers.set(shadowRoot, observer);
        };

        const scanThread = thread => {
            let hasGoods = false;
            const walk = node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (liveRules.goodsComments && node.matches('[data-type="goods"]')) {
                        hasGoods = true;
                    }
                    const tag = node.localName;
                    const shadowRoot = node.shadowRoot;
                    if (shadowRoot) {
                        observeRoot(shadowRoot);
                        if (tag === 'bili-comment-renderer' || tag === 'bili-comment-reply-renderer') {
                            setManagedStyle(
                                shadowRoot.querySelector('#footer'),
                                'display',
                                liveRules.commentFooters ? 'none' : null
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
            setManagedStyle(
                thread,
                'display',
                liveRules.goodsComments && hasGoods ? 'none' : null
            );
        };

        const applyRules = () => {
            const commentsHost = document.querySelector('#commentapp > bili-comments');
            const root = commentsHost && commentsHost.shadowRoot;
            if (!root) {
                if (commentsHost) pendingHosts.add(commentsHost);
                return;
            }

            observeRoot(root);
            setManagedStyle(
                root.querySelector('#contents'),
                'padding-top',
                liveRules.commentPadding ? '0px' : null
            );
            root.querySelectorAll('#feed > bili-comment-thread-renderer').forEach(scanThread);

            const headerHost = root.querySelector('#header > bili-comments-header-renderer');
            const headerRoot = headerHost && headerHost.shadowRoot;
            if (headerHost && !headerRoot) {
                pendingHosts.add(headerHost);
                return;
            }
            if (headerRoot) {
                observeRoot(headerRoot, true);
                setManagedStyle(
                    headerRoot.querySelector('#navbar'),
                    'margin-bottom',
                    liveRules.navbarMargin ? '0px' : null
                );
                setManagedStyle(
                    headerRoot.querySelector('#commentbox'),
                    'display',
                    liveRules.commentInput ? 'none' : null
                );
                setManagedStyle(
                    headerRoot.querySelector('.bili-comments-bottom-fixed-wrapper'),
                    'display',
                    liveRules.floatingCommentInput ? 'none' : null
                );
            }
        };

        const documentObserver = new MutationObserver(scheduleApply);
        documentObserver.observe(document, { childList: true, subtree: true });
        applyRules();

        const pendingTimer = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            let found = false;
            for (const host of pendingHosts) {
                if (!host.isConnected) pendingHosts.delete(host);
                else if (host.shadowRoot) {
                    pendingHosts.delete(host);
                    observeRoot(host.shadowRoot, host.localName === 'bili-comments-header-renderer');
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

        return nextRules => {
            liveRules = { ...nextRules };
            scheduleApply();
        };
    };

    let updateBilibiliShadowRules = () => {};
    if (currentSite.id === 'bilibili') {
        updateBilibiliShadowRules = installBilibiliShadowRules({
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
        syncBilibiliRules = () => updateBilibiliShadowRules({
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

    if (typeof GM_addValueChangeListener === 'function') {
        for (const feature of ['style', 'block']) {
            GM_addValueChangeListener(
                featureEnabledKey(feature, currentSite.id),
                (_key, _oldValue, newValue) => {
                    if (typeof newValue === 'boolean') currentSettings[feature] = newValue;
                    refreshCurrentPageRules();
                }
            );
            for (const item of currentRuleItems[feature]) {
                GM_addValueChangeListener(
                    itemEnabledKey(feature, currentSite.id, item.id),
                    () => refreshCurrentPageRules()
                );
            }
        }
    }

    /*
     * X、知乎等单页应用会在不刷新的情况下切换路由。
     * 路径变化时重新生成样式表，避免 /home 的规则残留到帖子页等其他路由。
     */
    const checkPathChange = () => {
        const nextPathname = location.pathname;
        if (nextPathname === pathname) return;
        pathname = nextPathname;
        refreshCurrentPageRules();
    };

    const installHistoryRouteWatcher = () => {
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            if (typeof original !== 'function' || original.__beautifyRouteHook) continue;

            const wrapped = function (...args) {
                const result = Reflect.apply(original, this, args);
                queueMicrotask(checkPathChange);
                return result;
            };
            Object.defineProperty(wrapped, '__beautifyRouteHook', { value: true });

            try {
                Object.defineProperty(history, method, {
                    configurable: true,
                    writable: true,
                    value: wrapped
                });
            } catch (error) {
                // 某些页面可能限制 History 实例属性；popstate 监听仍可覆盖后退/前进导航。
            }
        }

        window.addEventListener('popstate', checkPathChange);
        window.addEventListener('hashchange', checkPathChange);
    };

    installHistoryRouteWatcher();
    refreshCurrentPageRules();
})();
