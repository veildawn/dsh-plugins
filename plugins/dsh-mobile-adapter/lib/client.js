(function ensureCryptoRandomUUID() {
  if (typeof globalThis === 'undefined') return
  const crypto = globalThis.crypto || (globalThis.crypto = {})
  if (typeof crypto.randomUUID === 'function') return
  crypto.randomUUID = function randomUUID() {
    if (typeof crypto.getRandomValues === 'function') {
      return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (digit) =>
        (digit ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> digit / 4).toString(16)
      )
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (placeholder) => {
      const random = Math.random() * 16 | 0
      return (placeholder === 'x' ? random : random & 3 | 8).toString(16)
    })
  }
})()

window.__ModuleLoader__.load({
  id: '@weniatall/dsh-mobile-adapter',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    const inject = ['layout']
    const MOBILE_QUERY = '(max-width: 768px)'

    const css = `
      .dsh-mobile-bar,.dsh-mobile-backdrop,.dsh-mobile-tools-backdrop,.dsh-mobile-tools-menu{display:none}
      @media (max-width:768px){
        html,body,#root,[data-slot="root"]{box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:hidden;overscroll-behavior:none}
        #root{height:100dvh}
        .dsh-mobile-bar{box-sizing:border-box;position:fixed;z-index:900;top:0;right:0;left:0;height:calc(52px + var(--dsh-sat));padding:var(--dsh-sat) max(6px,var(--dsh-sar)) 0 max(6px,var(--dsh-sal));border-bottom:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-base) 92%,transparent);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);align-items:center;gap:4px;color:var(--dsw-alias-label-primary);display:flex}
        .dsh-mobile-icon{box-sizing:border-box;width:40px;height:40px;flex:none;border:0;border-radius:10px;background:transparent;color:inherit;font:600 21px/1 var(--dsw-font-family);display:grid;place-items:center;cursor:pointer}
        .dsh-mobile-icon:hover,.dsh-mobile-icon:active,.dsh-mobile-view:hover,.dsh-mobile-view:active,.dsh-mobile-btn:hover,.dsh-mobile-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
        .dsh-mobile-btn{box-sizing:border-box;width:34px;min-width:34px;height:34px;flex:none;border:0;border-radius:8px;background:transparent;color:inherit;display:inline-grid;place-items:center;cursor:pointer;padding:0}
        .dsh-mobile-btn[hidden]{display:none}
        .dsh-mobile-view{box-sizing:border-box;min-width:54px;height:32px;flex:none;border:0;border-radius:16px;background:var(--dsw-alias-interactive-bg-subtle,rgba(128,128,128,.12));color:inherit;font:600 12px/1 var(--dsw-font-family);display:inline-flex;align-items:center;justify-content:center;gap:3px;padding:0 8px;cursor:pointer;white-space:nowrap}
        .dsh-mobile-view[hidden]{display:none}
        /* 顶部 3 层融合成 1 层：
           1. 彻底隐藏第 3 层原生的 Tabs（对话 / 轨迹标签栏），由顶栏药丸按钮承接双向切换；
           2. 宿主原生的第 2 层 Header（wSkVaW_header / titleRow）移出普通流变为 0 占位，
              所有功能（真实标题、下拉改名、··· 菜单、◫ 侧栏开关）由移动顶栏统揽并代理；
           3. 释放原本占用的 76px+ 纵向高度，内容滚动区直接顶贴单层顶栏。 */
        [data-slot="conversation"] :is(.wSkVaW_tabs,[data-conversation-tabs],[role="tablist"]),
        [data-slot="conversation.session.header"] [role="tablist"]{display:none!important}
        :is(.wSkVaW_header,header[class$="_header"]:has(>[class*="_titleRow"])){position:fixed!important;top:var(--dsh-sat,0px)!important;right:0!important;left:0!important;height:calc(52px + var(--dsh-sat))!important;min-height:0!important;padding:0!important;border-bottom:none!important;pointer-events:none!important;opacity:0!important;z-index:-1!important;overflow:hidden!important}
        /* 顶部操作下拉面板：把「☰ 会话侧栏 / ⌁ 轨迹 / ⋯ 会话操作 / ◫ 右侧面板」
           四个入口收进一个下拉，顶栏只留「下拉 + 全屏」两个按钮。
           理由：52px 高的顶栏里塞四个图标 + 一个药丸 + 标题，在 360px 窄屏上
           标题被挤成三个字加省略号，可用性比「多点一次」差得多。
           面板用 fixed 定位（锚点由脚本按按钮实际位置写入），避免被顶栏裁切。 */
        /* 顶栏里被收进下拉面板的原始入口：保留在 DOM 中作为点击代理，
           但必须完全不占位（否则顶栏会被撑开、标题再次被挤扁）。 */
        .dsh-mobile-bar>.dsh-mobile-icon[hidden],
        .dsh-mobile-bar>.dsh-mobile-view[hidden],
        .dsh-mobile-bar>.dsh-mobile-btn[hidden]{display:none!important}
        .dsh-mobile-menu-toggle{box-sizing:border-box;width:36px;min-width:36px;height:36px;flex:none;border:0;border-radius:10px;background:transparent;color:inherit;display:inline-grid;place-items:center;cursor:pointer;padding:0}
        .dsh-mobile-menu-toggle:hover,.dsh-mobile-menu-toggle:active,.dsh-mobile-menu-toggle[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}
        .dsh-mobile-menu-backdrop{position:fixed;inset:0;z-index:1340;background:transparent}
        .dsh-mobile-menu-panel:not([hidden]){display:flex!important;position:fixed!important;top:var(--dsh-menu-anchor-top,auto)!important;left:var(--dsh-menu-anchor-left,auto)!important;right:auto!important;bottom:auto!important;z-index:1360!important;min-width:196px!important;max-width:calc(100vw - 20px)!important;width:max-content;padding:6px!important;border:1px solid var(--dsw-alias-border-l2)!important;border-radius:14px!important;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-base)))!important;box-shadow:var(--dsw-shadow-lv3)!important;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;flex-direction:column!important;gap:2px;overflow:visible!important;animation:dsh-mobile-menu-pop .14s cubic-bezier(0.2,0.8,0.2,1)}
        .dsh-mobile-menu-panel{display:none}
        @keyframes dsh-mobile-menu-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        .dsh-mobile-menu-item{display:flex;align-items:center;gap:10px;width:100%;height:42px;padding:0 10px;border:none;border-radius:10px;background:none;color:inherit;font:inherit;font-weight:500;text-align:left;cursor:pointer;user-select:none;white-space:nowrap;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
        .dsh-mobile-menu-item:hover,.dsh-mobile-menu-item:active{background:var(--dsw-alias-interactive-bg-hover)}
        .dsh-mobile-menu-item[hidden]{display:none}
        .dsh-mobile-menu-item-icon{display:inline-grid;place-items:center;width:20px;height:20px;flex:none;opacity:.9}
        .dsh-mobile-menu-item-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
        .dsh-mobile-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2);opacity:.6}
        /* 全屏切换：只收起浏览器自身的地址栏与底部工具栏，应用自己的导航
           一律保留。全屏后视口变高，根容器与滚动区跟随 100dvh 重铺。 */
        .dsh-mobile-fullscreen-toggle{box-sizing:border-box;width:40px;min-width:40px;height:36px;flex:none;border:0;border-radius:10px;background:transparent;color:inherit;display:inline-grid;place-items:center;cursor:pointer;padding:0}
        .dsh-mobile-fullscreen-toggle:hover,.dsh-mobile-fullscreen-toggle:active{background:var(--dsw-alias-interactive-bg-hover)}
        /* 浏览器全屏后视口变高：根容器与滚动区跟随重铺，避免底部留白或
           输入框被挤出屏幕。用 :fullscreen 伪类双保险——即使脚本没能改到
           data 属性（例如用户通过浏览器菜单进入全屏），布局也能自洽。 */
        html[data-dsh-mobile-fullscreen=true],
        html[data-dsh-mobile-fullscreen=true] body,
        html:fullscreen,
        html:fullscreen body{height:100dvh!important;overflow:hidden!important}
        html[data-dsh-mobile-fullscreen=true] #root,
        html:fullscreen #root{height:100dvh!important}
        html[data-dsh-mobile-fullscreen=true] [data-composer-seat],
        html:fullscreen [data-composer-seat]{padding-bottom:max(8px,var(--dsh-sab))!important}
        .dsh-mobile-titlebox{min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center;gap:1px}
        .dsh-mobile-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--dsw-font-s-strong-14);font-weight:600}
        .dsh-mobile-status{display:flex;width:max-content;max-width:100%;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dsh-mobile-status:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
        .dsh-mobile-status[data-running=true]:before{background:var(--dsw-alias-state-business-primary);animation:dsh-mobile-pulse 1.2s ease-in-out infinite alternate}
        .dsh-mobile-status[data-plan=true]{color:var(--dsw-alias-state-warn-label);font-weight:600}
        .dsh-mobile-status[data-plan=true]:before{background:var(--dsw-alias-state-warn-primary)}
        .dsh-mobile-backdrop:not([hidden]){display:block;position:fixed;z-index:980;inset:0;background:rgba(0,0,0,.42);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
        [data-slot="root"]>div{height:100%!important;min-height:0;grid-template-columns:0 minmax(0,1fr) 0!important}
        [data-slot="root"]>div>div:has(>[data-slot="sidebar"]){box-sizing:border-box;position:fixed;z-index:1000;inset:0 auto 0 0;width:min(86vw,320px)!important;padding-left:var(--dsh-sal);padding-right:0;background:var(--dsw-specific-sidebar-fill);box-shadow:var(--dsw-shadow-lv3);transform:translateX(0);transition:transform .24s var(--ds-ease-in-out);overflow:visible}
        [data-slot="root"]>div[data-sidebar-collapsed]>div:has(>[data-slot="sidebar"]){transform:translateX(-105%);box-shadow:none}
        [data-slot="sidebar"]{--dsh-sidebar-inline-padding:12px!important;box-sizing:border-box;width:100%!important;max-width:100%!important;height:100%}
        [data-slot="sidebar"]>*{height:100%}
        .hHd-Xa_root{--dsh-sidebar-inline-padding:12px!important;box-sizing:border-box;width:100%!important;max-width:100%!important;padding-left:12px!important;padding-right:12px!important}
        [data-slot="sidebar"] :where(:is(.hHd-Xa_newSession,[class$="_newSession"]),:is(.hHd-Xa_navList,[class$="_navList"]),:is(.hHd-Xa_regionArea,[class$="_regionArea"]),:is(.hHd-Xa_footerActions,[class$="_footerActions"]),:is(.hHd-Xa_settingsArea,[class$="_settingsArea"]),[role="tree"],[role="treeitem"],[data-slot="sidebar.settings"],[class*="_triggerRow"],[class*="_trigger"],:is(.VOzbGW_trigger,[class$="_trigger"])){box-sizing:border-box;width:100%!important;max-width:100%!important;margin:0!important}
        [data-slot="sidebar"] :where(:is(.hHd-Xa_regionArea,[class$="_regionArea"])){padding-left:0!important;padding-right:0!important}
        /* 移动端没有 hover：核心把工作区行右侧按钮（⋯ 工作区菜单、＋ 新建会话）
           藏在 .YDXeBa_rowActions 里仅 hover/menuOpen 显示，触屏永远点不到。
           这里显式常显，并放大触控区（行高 34px 内容区留给按钮 28px）。 */
        .YDXeBa_projectRow .YDXeBa_rowActions,
        .YDXeBa_sessionRow .YDXeBa_rowActions{display:inline-flex!important;gap:6px!important;height:28px!important;align-items:center!important}
        .YDXeBa_projectRow .YDXeBa_rowActions .YDXeBa_iconButton,
        .YDXeBa_sessionRow .YDXeBa_rowActions .YDXeBa_iconButton{width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important;border-radius:50%!important;padding:0!important}
        .YDXeBa_sessionRow .YDXeBa_time{display:none!important}
        /* 工作区行的展开/收起三角在宿主里只在 :hover 时露出
           （.YDXeBa_projectRow .YDXeBa_chevron{display:none}，
           :hover 时才 display:inline-flex），触屏设备既没有 hover 也没有指针，
           于是「点一下展开/收起」在手机上看起来完全没反应——文件夹图标与
           箭头之间还会互相顶替。这里让三角常显、独占自己的槽位，并把
           文件夹图标固定成「开/合」两种状态（由 aria-expanded 驱动），
           点击行任意位置都命中宿主自己的 onToggle。
           注意不能只改箭头显隐：宿主同时写了
           .YDXeBa_projectRow:hover .YDXeBa_folder{display:none}，
           触屏上一旦按下就会把文件夹换成箭头，视觉上像图标在乱跳。 */
        .YDXeBa_projectRow .YDXeBa_chevron{display:inline-flex!important;opacity:.85}
        .YDXeBa_projectRow .YDXeBa_folder{display:inline-flex!important}
        .YDXeBa_projectRow:hover .YDXeBa_folder{display:inline-flex!important}
        /* 三角原本 16px 宽，与文件夹图标挤在一起；触屏给行留出明确的点击区。 */
        .YDXeBa_projectRow{min-height:40px!important;gap:4px!important}
        .YDXeBa_projectRow .YDXeBa_arrow{transition:transform .15s var(--ds-ease-in-out)}
        .YDXeBa_projectRow[aria-expanded="true"] .YDXeBa_arrow{transform:rotate(90deg)}
        .YDXeBa_projectRow[aria-expanded="false"] .YDXeBa_arrow{transform:rotate(0deg)}
        /* 会话行在触屏上也要有可点的行高，且右侧按钮常显后不再挤压标题。 */
        .YDXeBa_sessionRow{min-height:40px!important}
        .YDXeBa_sessionRow .YDXeBa_title{min-width:0!important;flex:1 1 auto!important}
        .pI_x6G_centerCol,
        [data-slot="root"]>div>div:has(>[data-slot="conversation"]),
        [data-slot="root"]>div>div:has([data-slot*="main"]),
        [data-slot="root"]>div>div:has([data-slot*="conversation"]){grid-column:2!important;box-sizing:border-box;display:flex;width:100vw;height:100%;min-height:0;padding:calc(52px + var(--dsh-sat)) var(--dsh-sar) var(--dsh-keyboard-inset,0px) var(--dsh-sal);overflow:hidden}
        /* 移动端右侧栏（文件查看器/终端等 dockkit 面板）适配：
           原版右栏在窄屏 autoFullscreen 成 100vw 贴顶绝对定位，其顶部 tabStrip
           会被固定定位的 .dsh-mobile-bar (z-index 900) 整条盖住，面板自带的
           收起按钮尺寸也只有 28x28，触屏既看不到也点不到。这里：
           1. 面板整体下移一个导航栏高度（含安全区），让 tabStrip 完全露出；
           2. 放大 tabStrip 与收起/全屏按钮的触控区；
           3. 顶栏右上角在右栏展开时显示「← 对话」，一键收起回到会话；
           4. 冷启动若右栏仍是展开态则自动收起（见 checkInitialRightbar）。 */
        [data-sidebar-right-session] [class*="P3OORG_panel"],
        [data-sidebar-right-session] [data-sidebar-right-panel]{
          box-sizing:border-box!important;
          top:calc(52px + var(--dsh-sat))!important;
          height:calc(100% - 52px - var(--dsh-sat))!important;
          z-index:860!important;
        }
        [class*="_tabStrip_"]{
          min-height:44px!important;
          height:auto!important;
          padding-top:8px!important;
          padding-bottom:8px!important;
        }
        [data-sidebar-right-toggle],
        [data-sidebar-right-mode],
        [class*="P3OORG_iconButton"]{
          width:36px!important;
          height:36px!important;
          min-width:36px!important;
          min-height:36px!important;
          border-radius:10px!important;
        }
        [data-slot="conversation"]{flex:1 1 0;height:100%;min-width:0;min-height:0}
        .gehEqa_root,[class*="_root"]:has(>[class*="_body"]){--dsh-chat-content-width:100%!important;--dsh-composer-card-max-width:100%!important}
        .gehEqa_widthHandle,[class*="_widthHandle"]{display:none!important}
        [data-slot="conversation.session.header"]>header{display:none!important}
        .gehEqa_heroWorkspaceRow{box-sizing:border-box;width:100%;padding:0 20px!important;gap:4px!important;flex-wrap:wrap}
        .f0iH8G_workspace{box-sizing:border-box;min-width:0!important;max-width:100%!important;min-height:36px!important;flex:1 1 140px}
        [data-slot="conversation.hero.agentPreset"]>span{min-width:0;max-width:min(50%,240px);flex:0 1 auto}
        [data-slot="conversation.hero.agentPreset"] :is(.cubgiG_seat,[class$="_seat"]){box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:36px;min-height:36px;padding:0 10px;border-radius:999px}
        [data-conversation-scroll]{flex:1 1 0;min-width:0;min-height:0;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
        [data-conversation-scroll] :has(>[data-chat-flow]){padding-right:12px!important;padding-left:12px!important}
        [data-chat-flow]{width:100%;max-width:100%;gap:12px!important}
        [data-chat-anchor-key],[data-chat-flow]>*{min-width:0;max-width:100%}
        [data-chat-flow] [class*="_userStack"]{max-width:min(88%,calc(100vw - 48px))}
        [data-chat-flow] [class*="_gallery"],[data-chat-flow] [class*="_frame"]{max-width:100%!important}
        [data-chat-flow] :where(img,video,canvas,svg){max-width:100%;height:auto}
        [data-chat-flow] [class*="_actions"]{box-sizing:border-box;display:flex;flex-wrap:wrap!important;width:100%!important;max-width:100%!important;min-width:0!important;height:auto!important;min-height:32px;align-items:center;gap:6px!important;padding-right:max(4px,var(--dsh-sar));overflow:visible!important}
        ._8_XoUG_action,.TS9iAW_actions{flex-wrap:wrap!important}
        .TS9iAW_actions{height:auto!important;max-width:100%;min-width:0;overflow:visible!important}
        [data-chat-flow] [class*="_actions"] button{box-sizing:border-box;flex:0 0 32px;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;border-radius:50%!important;padding:5px}
        [data-chat-flow] [class*="_actions"] :where([class*="_timeStart"],[class*="_timeEnd"]){display:none!important}
        /* 输入框下方的 dock（「N 轮 M 步 · tok/s」「用量 · 缓存命中」统计行与
           上下文用量圆环）在移动端固定为**单行三列**：
             [轮次/速度] [用量/缓存] [上下文圆环]
           实现上只约束三个「容器」层级，绝不改写宿主药丸的内部布局：
           宿主的 .pill 本身是 inline-flex（图标 + 文字 + 分隔符 + 文字同一行），
           一旦被套上 display:block 或列宽，就会变成「图标一行、文字一行」。
           宽度不够时统计列收缩、文字走省略号，圆环列保持完整。
           选择器只认宿主写死的 data-composer-dock，或脚本在移动端打上的
           data-dsh-dock（旧宿主只有哈希类名，由 balanceComposerDock() 识别后标记）。
           不写具体哈希类名：附件队列 _7yHdaG_dock 也以 _dock 结尾，误伤它会把
           附件面板的排版一起改掉。 */
        [data-composer-dock],[data-dsh-dock]{box-sizing:border-box;width:auto;max-width:100%;min-width:0;flex-wrap:nowrap!important;justify-content:space-between!important;align-items:center!important;column-gap:4px!important;row-gap:0!important;padding:2px 8px 0!important;overflow:hidden!important;overscroll-behavior-x:contain!important}
        /* 统计槽位（宿主把两个药丸装在 conversation.composer.dock 里）：横向单行。 */
        [data-slot="conversation.composer.dock"]{box-sizing:border-box!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:6px!important;width:auto!important;min-width:0!important;max-width:100%!important;overflow:hidden!important}
        /* 参与分列的只有槽位与圆环；圆环不收缩，统计槽位吃掉剩余宽度。 */
        [data-composer-dock]>*,[data-dsh-dock]>*{min-width:0!important;overflow:hidden!important}
        /* 统计槽位吃掉剩余宽度，圆环保持内容宽度。 */
        [data-composer-dock]>:not(:last-child),[data-dsh-dock]>:not(:last-child){flex:1 1 auto!important}
        [data-composer-dock]>:last-child,[data-dsh-dock]>:last-child{flex:0 0 auto!important}
        /* 药丸整体可收缩，但绝不换行、不改宿主的 inline-flex 内部布局。
           宿主药丸自带 padding:1px 8px、圆环自带 padding:1px 8px + gap:6px，
           在 360px 级别的可用宽度里这 40px 固定开销正好挤掉半段文字，全部收掉。 */
        [data-composer-dock] [data-composer-stat],[data-dsh-dock] [data-composer-stat]{flex:0 1 auto!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;font-size:10.5px!important;line-height:14px!important}
        /* 槽位内两个药丸等分宽度：flex:0 1 auto 会让后一个吃掉前一个的收缩空间，
           出现「240 tok/s」被压成「24」而另一段几乎不缩的不均等截断。 */
        [data-slot="conversation.composer.dock"] [data-composer-stat]{flex:1 1 0!important;min-width:0!important;max-width:50%!important}
        [data-composer-dock] [data-composer-stat] :is(button,span),[data-dsh-dock] [data-composer-stat] :is(button,span){font-size:10.5px!important;line-height:14px!important;white-space:nowrap!important;padding:0!important;gap:3px!important}
        /* 上下文圆环同样收掉内边距：它是状态标签，不需要按钮级的呼吸区。 */
        [data-composer-dock] [class*="JObwrW_trigger"],[data-dsh-dock] [class*="JObwrW_trigger"],
        /* 收缩压力只落在每段的**末位文字**上（如「缓存命中 99.8%」），前面的
           数值/轮次与分隔符「·」保持完整——否则各段被平均压缩，会变成
           「3 轮…」「24…」这种每段都碎掉的形态，分隔符还会被挤成孤零零一个点。
           宿主结构：pill > [svg, label, sep(·), label]。 */
        [data-composer-dock] [data-composer-stat] :is(button,span),[data-dsh-dock] [data-composer-stat] :is(button,span){flex:0 0 auto!important;min-width:0!important}
        /* 末位文字保留最小宽度：flex 压缩到 0 宽时 text-overflow 不产生省略号，
           整段会直接「消失」（实测速度那格变成空白）。留 3em 保证至少看到「…」。 */
        /* 末位文字的下限放宽到 4.5em：3em 在 320px 屏上只够显示「2」，看不清是什么。 */
        [data-composer-dock] [data-composer-stat] :is(button,span):last-child,[data-dsh-dock] [data-composer-stat] :is(button,span):last-child{flex:0 1 auto!important;min-width:4.5em!important;overflow:hidden!important;text-overflow:ellipsis!important}
        /* 每段的前置数值（轮次/步数、总量）保底 3em，窄屏也不至于被压没。 */
        [data-composer-dock] [data-composer-stat] :is(button,span):not(:last-child):not([class*="_sep"]),[data-dsh-dock] [data-composer-stat] :is(button,span):not(:last-child):not([class*="_sep"]){min-width:3em!important}
        [data-composer-dock] [data-composer-stat] :is(button,span):not(:last-child),[data-dsh-dock] [data-composer-stat] :is(button,span):not(:last-child){overflow:visible!important;max-width:none!important;flex:0 0 auto!important}
        /* 分隔符与图标一样是固定宽度，不参与收缩。 */
        [data-composer-dock] [data-composer-stat] [class*="_sep"],[data-dsh-dock] [data-composer-stat] [class*="_sep"]{flex:0 0 auto!important;overflow:visible!important}
        [data-composer-dock] [data-composer-stat] svg,[data-dsh-dock] [data-composer-stat] svg{width:11px!important;height:11px!important;flex:none!important}
        /* 超窄屏（<=360px）下实在塞不进四段：隐藏每段的末位文字（速度、缓存命中率）
           与分隔符，只留「N 轮 M 步」和总量。这比把每段都压成「2」「缓」可读得多，
           完整数值仍可从宿主药丸的点击面板里看到。 */
        @media (max-width:360px){
          [data-composer-dock] [data-composer-stat] :is([class*="_sep"],button>span:last-child:not([class*="_sep"])),
          [data-dsh-dock] [data-composer-stat] :is([class*="_sep"],button>span:last-child:not([class*="_sep"])){display:none!important}
        }
        /* 由脚本配平的收纳态：卡片预留出 dock 的高度，dock 用等量负边距回到
           卡片内部。高度取自真实测量值（--dsh-dock-reserve），所以统计行折行、
           meter 高度随宿主换代变化时都不会再出现「圆环浮在输入框外」或
           「卡片底部留一大块空白」。旧实现依赖 :has(+dock :is(...))，在
           不支持 :has() 的移动端内核上整条失效，正是圆环掉出卡片的原因。 */
        [data-composer-card][data-dsh-dock-reserve]{padding-bottom:calc(var(--dsh-dock-reserve,0px) + 2px)!important}
        [data-dsh-dock-balanced]{box-sizing:border-box!important;width:auto!important;max-width:100%!important;margin-top:calc(0px - var(--dsh-dock-reserve,0px))!important;padding:0 12px 6px!important;position:relative!important;z-index:1!important}
        [data-composer-seat]{flex:none;bottom:0;padding-bottom:max(8px,var(--dsh-sab))}
        [data-composer-card]{box-sizing:border-box;max-width:none!important;border-radius:18px!important;padding:8px 10px 6px!important}
        [data-composer-card]>:last-child{box-sizing:border-box;display:flex;width:100%;min-height:44px;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between;gap:4px!important;padding:4px 8px 8px!important;overflow:visible!important}
        .ccegLa_tools,.ccegLa_trailing{box-sizing:border-box;display:flex;align-items:center;min-width:0}
        .ccegLa_tools{min-width:max-content;flex:1 1 auto;gap:4px!important;overflow:visible!important}
        .ccegLa_tools::-webkit-scrollbar{display:none}
        .ccegLa_modes{flex:none;flex-wrap:nowrap!important;align-items:center;gap:4px!important;overflow:visible!important}
        .ccegLa_trailing{flex:none;max-width:calc(100% - 36px);margin-left:auto;justify-content:flex-end;gap:6px!important;overflow:visible}
        .ccegLa_add{display:none!important}
        .uV2eYG_add,[data-composer-card] [class*="_add"],[data-composer-card] button[aria-haspopup="listbox"],button[aria-label*="指令"],button[aria-label*="commands" i]{display:none!important}
        /* Unified Mobile Action Button Spec (32x32 round circle, subtle background, clean border, centered icon) */
        .dsh-mobile-upload-btn,
        .dsh-mobile-tools-btn,
        .Sh0Q9G_trigger,
        .iWlSmW_trigger,
        .term-composer-btn,
        ._7KE1Ra_trigger {
          box-sizing:border-box!important;
          width:32px!important;
          height:32px!important;
          min-width:32px!important;
          min-height:32px!important;
          max-width:32px!important;
          max-height:32px!important;
          border-radius:50%!important;
          padding:0!important;
          margin:0!important;
          display:inline-grid!important;
          place-items:center!important;
          border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))!important;
          background:var(--dsw-specific-selector,rgba(0,0,0,.05))!important;
          color:var(--dsw-alias-label-secondary)!important;
          outline:none!important;
          flex:none!important;
          cursor:pointer!important;
          transition:all .12s ease!important;
          -webkit-tap-highlight-color:transparent!important;
        }
        .dsh-mobile-upload-btn:hover,.dsh-mobile-upload-btn:active,
        .dsh-mobile-tools-btn:hover,.dsh-mobile-tools-btn:active,
        .Sh0Q9G_trigger:hover,.Sh0Q9G_trigger:active,.iWlSmW_trigger:hover,.iWlSmW_trigger:active,
        .term-composer-btn:hover,.term-composer-btn:active,
        ._7KE1Ra_trigger:hover,._7KE1Ra_trigger:active,
        .NXnJXa_trigger:hover,.NXnJXa_trigger:active {
          background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.12))!important;
          color:var(--dsw-alias-label-primary)!important;
          transform:scale(.96)!important;
        }
        .dsh-mobile-upload-btn svg{width:16px;height:16px;flex:none;display:block}
        .ccegLa_primary{box-sizing:border-box;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;flex:none;border-radius:50%!important;display:grid;place-items:center;background:var(--dsw-alias-brand-primary,#4d6bfe)!important;color:var(--dsw-alias-label-primary-foreground,#fff)!important;border:none!important}
        .ccegLa_primary{transform:none!important}
        .ccegLa_primary:active{transform:scale(.96)!important}
        .Sh0Q9G_trigger,.iWlSmW_trigger,.ccegLa_select,.rS3zOq_chip,._7KE1Ra_trigger{box-sizing:border-box;height:32px!important;min-height:32px!important;font-size:12px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
        .rS3zOq_chip{box-sizing:border-box!important;width:max-content!important;height:32px!important;min-width:max-content!important;min-height:32px!important;padding:0 10px!important;border-radius:999px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:4px!important;white-space:nowrap!important;overflow:visible!important;flex:none!important;line-height:1!important}
        /* 计划复核/待办面板出现时不收纳 dock：面板需要完整的纵向空间，负边距会
           把它和输入区叠在一起。具体的高度配平由 balanceComposerDock() 负责。 */
        /* 计划复核/待办面板保留纵向布局。注意不能把 composer.dock 槽位也写成
           column：那是 dock 里装两个统计药丸的容器，纵向布局会把「N 轮 M 步」
           与「用量 · 缓存命中」上下堆成多行——正是「统计行没排成一行」的成因。 */
        [data-plan-review-key],[data-plan-review-scroll]{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;min-height:0!important;display:flex!important;flex-direction:column!important;overflow:visible!important}
        [data-slot="conversation.composer.dock"]{box-sizing:border-box!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:8px!important;width:auto!important;max-width:100%!important;min-width:0!important;overflow:hidden!important}
        [data-slot="conversation.composer.dock"]>*{flex:1 1 0!important;min-width:0!important;max-width:100%!important;overflow:hidden!important}
        [data-plan-review-scroll]{max-height:min(45dvh,360px)!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important}
        .Sh0Q9G_trigger,.iWlSmW_trigger,.ccegLa_select{max-width:32px!important;min-width:32px!important}
        .Sh0Q9G_triggerIcon,.iWlSmW_triggerIcon{display:inline-grid!important;place-items:center!important;flex:none;margin:0!important}
        .ccegLa_modes .Sh0Q9G_triggerLabel,.ccegLa_modes .iWlSmW_triggerLabel{display:none!important}
        .Sh0Q9G_triggerLabel,.iWlSmW_triggerLabel{display:none!important}
        .Sh0Q9G_chevron,.iWlSmW_chevron{display:none!important}
        ._7KE1Ra_root{flex:none!important;width:32px!important;max-width:32px!important;min-width:32px!important}
        ._7KE1Ra_triggerLabel,._7KE1Ra_triggerEffort,._7KE1Ra_chevron,._7KE1Ra_triggerIcon{display:none!important}
        ._7KE1Ra_trigger::before{content:"";width:16px;height:16px;display:block;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.5L14 4.5V11.5L8 14.5L2 11.5V4.5L8 1.5Z' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M8 1.5V14.5M2 4.5L14 11.5M2 11.5L14 4.5' stroke='black' stroke-width='1.1'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.5L14 4.5V11.5L8 14.5L2 11.5V4.5L8 1.5Z' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M8 1.5V14.5M2 4.5L14 11.5M2 11.5L14 4.5' stroke='black' stroke-width='1.1'/%3E%3C/svg%3E") center/contain no-repeat}
        .dsh-mobile-composer-info{box-sizing:border-box;width:100%;padding:2px 12px 4px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.2px}
        /* ── 模型和推理强度条完全跟随主题工作室的「状态条效果」，不跟主题 ────
           状态条效果是独立于主题的全局视觉动效，档位由 <html data-ts-status="<档位>"> 驱动。
           设计原则：
           ① 完全跟随状态条效果：用户在主题工作室设置里选了哪一档，模型条就呈现哪一档的胶囊与动效；
           ② 不跟主题：带 !important 压过 theme-studio 的主题样式（如 aurora 的静态极光环、glass 的毛玻璃），
              并屏蔽 ::before 装饰，确保呈现纯正的状态条视觉；
           ③ 零侵入：用户选「原生」或未安装主题工作室时（无 data-ts-status 或为 none），保持上面那条原生纯文本；
           ④ 纯 CSS 响应：零 JS 属性同步，在设置切换档位时浏览器 0ms 瞬间响应。 */
        html[data-ts-status] .dsh-mobile-composer-info{display:inline-flex!important;align-items:center!important;justify-content:center!important;position:relative!important;z-index:1!important;width:fit-content!important;max-width:calc(100% - 24px)!important;margin:0 auto 5px!important;padding:3px 14px!important;border-radius:999px!important;background:none!important;border:none!important;font-size:11px!important;line-height:15px!important;letter-spacing:0.2px!important;text-align:center!important;white-space:nowrap!important;overflow:visible!important;user-select:none!important;box-sizing:border-box!important;isolation:auto!important}
        /* 胶囊底色与外圈呼吸环由 ::before 垫底承载（z-index:-1），与文字流光彻底分层，
           彻底消除 background-clip:text 把胶囊底色与文字裁切混为一谈导致文字发糊发虚的缺陷 */
        html[data-ts-status] .dsh-mobile-composer-info::before{content:""!important;display:block!important;position:absolute!important;inset:0!important;z-index:-1!important;border-radius:inherit!important;background:color-mix(in srgb,var(--color-surface,var(--dsw-alias-bg-layer-2,#1e293b)) 82%,transparent)!important;border:1px solid color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 28%,transparent)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,0.12),0 2px 8px rgba(0,0,0,0.08)!important;pointer-events:none!important}
        /* shimmer / flow：文字高光横向流动扫过（只裁切文字自身，底色由 ::before 垫底保持清晰可见） */
        html[data-ts-status="shimmer"] .dsh-mobile-composer-info,
        html[data-ts-status="flow"] .dsh-mobile-composer-info{background:linear-gradient(100deg,var(--color-foreground-subtle,var(--dsw-alias-label-tertiary,#94a3b8)) 20%,var(--color-foreground,var(--dsw-alias-label-primary,#f8fafc)) 45%,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 55%,var(--color-foreground,var(--dsw-alias-label-primary,#f8fafc)) 70%,var(--color-foreground-subtle,var(--dsw-alias-label-tertiary,#94a3b8)) 92%)!important;background-size:280% 100%!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent!important;color:transparent!important;animation:dsh-mobile-status-shimmer 3.2s linear infinite!important}
        @keyframes dsh-mobile-status-shimmer{0%{background-position:180% 0}100%{background-position:-80% 0}}
        /* pulse / flow：胶囊外圈呼吸光环扩散（作用于 ::before，绝不覆盖文字自身渐变） */
        html[data-ts-status="pulse"] .dsh-mobile-composer-info::before,
        html[data-ts-status="flow"] .dsh-mobile-composer-info::before{animation:dsh-mobile-status-breathe 2.4s ease-in-out infinite!important}
        @keyframes dsh-mobile-status-breathe{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 30%,transparent),0 0 18px -6px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 22%,transparent)}70%{box-shadow:0 0 0 10px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 0%,transparent),0 0 18px -6px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 22%,transparent)}100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 0%,transparent),0 0 18px -6px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 22%,transparent)}}
        /* whale：游动微浮节奏 */
        html[data-ts-status="whale"] .dsh-mobile-composer-info{animation:dsh-mobile-status-whale 2.8s ease-in-out infinite!important}
        @keyframes dsh-mobile-status-whale{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
        /* neon：双色霓虹发光文字与边框脉冲 */
        html[data-ts-status="neon"] .dsh-mobile-composer-info{color:var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe))!important;text-shadow:0 0 4px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 70%,transparent),0 0 12px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 45%,transparent)!important}
        html[data-ts-status="neon"] .dsh-mobile-composer-info::before{border-color:color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 45%,transparent)!important;animation:dsh-mobile-status-neon 2.6s ease-in-out infinite!important}
        @keyframes dsh-mobile-status-neon{0%,100%{box-shadow:0 0 10px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 32%,transparent)}50%{box-shadow:0 0 22px color-mix(in srgb,var(--color-brand,var(--dsw-alias-brand-text,#8b5cf6)) 55%,transparent)}}
        /* terminal：复古终端等宽方角与光标扫描线 */
        html[data-ts-status="terminal"] .dsh-mobile-composer-info{border-radius:2px!important;font-family:var(--dsw-font-family-mono,ui-monospace,monospace)!important;color:var(--color-success,var(--dsw-alias-state-success-primary,#3fb950))!important;letter-spacing:.04em!important;text-shadow:0 0 8px color-mix(in srgb,var(--color-success,var(--dsw-alias-state-success-primary,#3fb950)) 45%,transparent)!important}
        html[data-ts-status="terminal"] .dsh-mobile-composer-info::before{border-radius:2px!important;border-color:color-mix(in srgb,var(--color-success,var(--dsw-alias-state-success-primary,#3fb950)) 38%,transparent)!important;background:color-mix(in srgb,var(--color-success,var(--dsw-alias-state-success-primary,#3fb950)) 6%,transparent)!important}
        html[data-ts-status="terminal"] .dsh-mobile-composer-info::after{content:""!important;position:absolute!important;inset:0!important;pointer-events:none!important;background:linear-gradient(to bottom,transparent 0%,color-mix(in srgb,var(--color-success,var(--dsw-alias-state-success-primary,#3fb950)) 16%,transparent) 50%,transparent 100%)!important;background-size:100% 260%!important;animation:dsh-mobile-status-scan 2.4s linear infinite!important}
        @keyframes dsh-mobile-status-scan{0%{background-position:0 -130%}100%{background-position:0 130%}}
        /* candy：糖果色微弹跳与柔光 */
        html[data-ts-status="candy"] .dsh-mobile-composer-info{color:var(--color-brand,var(--dsw-alias-brand-text,#8b5cf6))!important;text-shadow:0 1px 6px color-mix(in srgb,var(--color-brand,var(--dsw-alias-brand-text,#8b5cf6)) 50%,transparent)!important;animation:dsh-mobile-status-candy 1.8s ease-in-out infinite!important}
        html[data-ts-status="candy"] .dsh-mobile-composer-info::before{border-color:color-mix(in srgb,var(--color-brand,var(--dsw-alias-brand-text,#8b5cf6)) 34%,transparent)!important;background:color-mix(in srgb,var(--color-brand,var(--dsw-alias-brand-text,#8b5cf6)) 12%,transparent)!important}
        @keyframes dsh-mobile-status-candy{0%,100%{transform:translateY(0)}40%{transform:translateY(-1.5px)}70%{transform:translateY(.5px)}}
        /* glitch：RGB色散与随机抖动 */
        html[data-ts-status="glitch"] .dsh-mobile-composer-info{border-radius:4px!important;color:var(--color-foreground,var(--dsw-alias-label-primary,#fff))!important;text-shadow:-1px 0 color-mix(in srgb,var(--color-danger,var(--dsw-alias-state-error-primary,#f85149)) 70%,transparent),1px 0 color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 70%,transparent)!important;animation:dsh-mobile-status-glitch 2.8s steps(1) infinite!important}
        html[data-ts-status="glitch"] .dsh-mobile-composer-info::before{border-radius:4px!important;border-color:color-mix(in srgb,var(--color-danger,var(--dsw-alias-state-error-primary,#f85149)) 40%,transparent)!important;background:color-mix(in srgb,var(--color-foreground,var(--dsw-alias-label-primary,#fff)) 6%,transparent)!important}
        @keyframes dsh-mobile-status-glitch{0%{transform:translateX(0)}2%{transform:translateX(-2px)}4%{transform:translateX(2px)}6%,100%{transform:translateX(0)}}
        /* ring：环形旋转光晕 */
        html[data-ts-status="ring"] .dsh-mobile-composer-info{color:var(--color-foreground,var(--dsw-alias-label-primary,#f8fafc))!important;text-shadow:0 0 6px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 35%,transparent)!important}
        html[data-ts-status="ring"] .dsh-mobile-composer-info::before{border-color:color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 30%,transparent)!important;box-shadow:0 0 12px color-mix(in srgb,var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)) 35%,transparent)!important;animation:dsh-mobile-status-breathe 2.0s ease-in-out infinite!important}
        /* bar：胶囊下方三段音量跳动条 */
        html[data-ts-status="bar"] .dsh-mobile-composer-info{margin-bottom:9px!important;color:var(--color-foreground,var(--dsw-alias-label-primary,#f8fafc))!important}
        html[data-ts-status="bar"] .dsh-mobile-composer-info::after{content:""!important;position:absolute!important;left:50%!important;margin-left:-11px!important;bottom:-5px!important;width:22px!important;height:3px!important;pointer-events:none!important;background:linear-gradient(var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)),var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe))) left/4px 100% no-repeat,linear-gradient(var(--color-brand,var(--dsw-alias-brand-text,#8b5cf6)),var(--color-brand,var(--dsw-alias-brand-text,#8b5cf6))) center/4px 100% no-repeat,linear-gradient(var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe)),var(--color-primary,var(--dsw-alias-brand-primary,#4d6bfe))) right/4px 100% no-repeat!important;animation:dsh-mobile-status-bars 1.2s ease-in-out infinite!important}
        @keyframes dsh-mobile-status-bars{0%,100%{transform:scaleY(.5);opacity:.6}35%{transform:scaleY(1.4);opacity:1}70%{transform:scaleY(.8);opacity:.8}}
        /* 移动端电量与无障碍：减弱动效时全部停住，但保留胶囊外观 */
        @media (prefers-reduced-motion: reduce){
          html[data-ts-status] .dsh-mobile-composer-info,
          html[data-ts-status] .dsh-mobile-composer-info::before,
          html[data-ts-status] .dsh-mobile-composer-info::after{animation:none!important}
          html[data-ts-status] .dsh-mobile-composer-info{-webkit-text-fill-color:currentColor;color:var(--color-foreground,var(--dsw-alias-label-primary,#f8fafc))}
        }
        @media (prefers-contrast: more){
          html[data-ts-status] .dsh-mobile-composer-info{-webkit-text-fill-color:currentColor;color:var(--color-foreground,var(--dsw-alias-label-primary,#f8fafc));text-shadow:none!important}
        }
        .dsh-mobile-tools-backdrop:not([hidden]){display:block;position:fixed;inset:0;z-index:1340;background:transparent}
        /* 这条规则必须压过上面的 [role="menu"]{z-index:1300!important}：
           本菜单也带 role="menu"，被那条 !important 压到 1300 后会低于自己的
           遮罩(1340)，于是遮罩盖在菜单上，点“选项”实际点到透明遮罩 → 面板
           一点就消失、选项永远点不到。选择器加倍类名提高特异性并显式 !important。 */
        .dsh-mobile-tools-menu.dsh-mobile-tools-menu:not([hidden]){display:flex!important;position:fixed!important;top:var(--dsh-tools-anchor-top,auto)!important;left:var(--dsh-tools-anchor-left,auto)!important;right:auto!important;bottom:auto!important;z-index:1360!important;min-width:180px!important;max-width:calc(100vw - 24px)!important;max-height:none!important;width:max-content;padding:6px!important;border:1px solid var(--dsw-alias-border-l2)!important;border-radius:14px!important;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-base)))!important;box-shadow:var(--dsw-shadow-lv3)!important;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;flex-direction:column!important;gap:2px;overflow:visible!important;animation:dsh-mobile-tools-pop .14s cubic-bezier(0.2,0.8,0.2,1)}
        @keyframes dsh-mobile-tools-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        .dsh-mobile-tools-item{display:flex;align-items:center;gap:10px;width:100%;height:40px;padding:0 10px;border:none;border-radius:10px;background:none;color:inherit;font:inherit;font-weight:500;text-align:left;cursor:pointer;user-select:none;white-space:nowrap;-webkit-tap-highlight-color:transparent;touch-action:manipulation;-webkit-user-select:none}
        .dsh-mobile-tools-item:hover,.dsh-mobile-tools-item:active{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,0.1))}
        .dsh-mobile-tools-icon{display:inline-grid;place-items:center;width:20px;height:20px;flex:none;font-size:15px}
        /* 上下文用量是状态标签（圆环 + 百分比），不是动作按钮：套 32x32 圆形会把
           文字挤到圆环下方并被卡片边缘裁掉（实测 scrollH 41 > clientH 32）。这里
           改成内容自适应药丸，高度与其它按钮一致，宽度随百分比增长。 */
        .NXnJXa_root{width:auto!important;max-width:100%!important;height:32px!important;min-width:0!important;flex:none!important;display:inline-flex!important;align-items:center!important}
        .NXnJXa_trigger{box-sizing:border-box!important;width:auto!important;height:32px!important;min-width:0!important;max-width:none!important;max-height:32px!important;border-radius:999px!important;padding:0 10px!important;margin:0!important;display:inline-flex!important;flex-direction:row!important;align-items:center!important;justify-content:center!important;gap:6px!important;white-space:nowrap!important}
        .NXnJXa_trigger>span{display:inline-block!important;line-height:1!important;white-space:nowrap!important}
        /* dock 槽位让出宽度给 meter，长统计行收缩而不是把按钮挤出卡片 */
        .ccegLa_dock>[data-slot="conversation.composer.dock"]{flex:1 1 auto!important;width:auto!important;min-width:0!important;max-width:100%!important}
        /* 宿主 0.2.0-rc.2 起输入区由 <textarea> 换成了 contenteditable 宿主元素
           （[data-composer-input]），旧的 [data-composer-card] textarea 选择器已不再
           命中，防放大规则静默失效。iOS Safari 对计算字号小于 16px 的可编辑元素
           （input/textarea/select/contenteditable）聚焦时会强制放大整个视口，顶栏
           按钮被挤出屏幕；这里把输入区字号抬到 16px 下限（用户设置的更大字号照常
           生效），占位符同步字号以免与输入文字错位。
           选择器只用宿主稳定的 data 属性：桌面版与 npm 版的 CSS Modules 哈希类名
           并不相同，写死哈希类名会在其中一个宿主上全部失效。 */
        [data-composer-input],[data-composer-placeholder]{font-size:max(16px,var(--dsh-content-font-size,14px))!important}
        .md-code-block button,[role="dialog"] button{min-width:44px;min-height:44px}
        .md-code-block{max-width:100%;overflow:hidden}
        .md-code-block pre{max-width:100%;overflow-x:auto!important;overscroll-behavior-x:contain;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;white-space:pre!important;word-break:normal!important}
        [data-slot="root"]>div>div:has(>[data-slot="details"]){box-sizing:border-box;position:fixed;z-index:850;inset:calc(52px + var(--dsh-sat)) 0 var(--dsh-keyboard-inset,0px);width:100vw!important;background:var(--dsw-alias-bg-base);transform:translateX(0);transition:transform .24s var(--ds-ease-in-out),visibility 0s;overflow:auto}
        [data-slot="root"]>div[data-details-collapsed]>div:has(>[data-slot="details"]){visibility:hidden;pointer-events:none;transform:translateX(100%);transition:transform .24s var(--ds-ease-in-out),visibility 0s linear .24s}
        [data-slot="details"] button{min-width:44px;min-height:44px}
        [data-conversation-composer-overlay]>:last-child{z-index:auto!important;isolation:auto!important;overflow:visible!important}
        .Y0dWHa_split{display:flex;position:static!important;flex-direction:column;min-width:0;min-height:0;overflow:visible!important;container-type:normal!important}
        .Y0dWHa_tablePane{width:100%;min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
        .Y0dWHa_table{width:100%;min-width:0;table-layout:fixed}
        .Y0dWHa_eventColumn{width:58px!important}
        .Y0dWHa_table th,.Y0dWHa_table td{height:36px!important}
        :is(.Y0dWHa_details,aside[class$="_details"]){box-sizing:border-box;position:fixed!important;z-index:950!important;inset:calc(52px + var(--dsh-sat)) 0 var(--dsh-keyboard-inset,0px)!important;width:100vw!important;max-width:none!important;min-width:0!important;border-left:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-layer-1);animation:dsh-mobile-detail-in .24s var(--ds-ease-in-out)}
        .Y0dWHa_detailsResizeHandle{display:none!important}
        .Y0dWHa_detailsHeader{height:52px!important;padding:0 max(8px,var(--dsh-sar)) 0 max(12px,var(--dsh-sal))!important}
        .Y0dWHa_detailsTitle{min-width:0;overflow:hidden}
        .Y0dWHa_close{width:44px!important;height:44px!important;min-width:44px;min-height:44px}
        .Y0dWHa_detailTabs{height:44px!important;padding:0 max(8px,var(--dsh-sar)) 0 max(8px,var(--dsh-sal))!important;scroll-behavior:smooth;-webkit-overflow-scrolling:touch}
        .Y0dWHa_detailTab{min-width:44px;min-height:44px}
        .Y0dWHa_detailBody{max-width:100%;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
        .Y0dWHa_overview>div{grid-template-columns:minmax(76px,30%) minmax(0,1fr);padding-right:12px;padding-left:12px}
        .Y0dWHa_overview dd{white-space:normal;overflow-wrap:anywhere}
        .Y0dWHa_promptDiffSections,.Y0dWHa_promptDiff,.Y0dWHa_jsonPayload,.Y0dWHa_jsonPreview,.Y0dWHa_schemaTree{box-sizing:border-box;max-width:100%;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
        .Y0dWHa_promptDiff,[aria-label="Event details"] [role="tree"]{overflow-x:auto;scroll-behavior:smooth}
        [data-conversation-scroll]:has([data-conversation-composer-overlay]) [data-composer-seat]{display:none!important}
        [data-conversation-composer-overlay]{--dsh-trajectory-toolbar-height:44px!important;--dsh-composer-height:0px!important}
        [data-conversation-composer-overlay]>:first-child{height:44px!important}
        [data-conversation-composer-overlay]>:first-child [class*="_inner"]{overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch}
        [data-conversation-composer-overlay]>:first-child button{min-height:44px}
        [data-conversation-composer-overlay] input[type="search"]{font-size:16px}
        [data-conversation-composer-overlay] [class*="_plot"]{grid-template-columns:32px minmax(0,1fr);height:48px}
        [data-conversation-composer-overlay] [class*="_labels"]{font-size:9px}
        body>div[role="presentation"]:has(>[role="dialog"][aria-modal="true"]){box-sizing:border-box;position:fixed!important;z-index:1200!important;inset:0!important;width:100vw!important;height:var(--dsh-vvh,100dvh)!important;padding:max(16px,var(--dsh-sat)) max(16px,var(--dsh-sar)) max(16px,var(--dsh-sab)) max(16px,var(--dsh-sal));display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,.5)!important;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);overflow:visible!important}
        body>div[role="presentation"]:has(>[role="dialog"][aria-modal="true"])>[aria-hidden="true"]{position:absolute!important;inset:0!important;background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
        body>div[role="presentation"]>[role="dialog"][aria-modal="true"]{box-sizing:border-box;position:relative!important;inset:auto!important;width:min(92vw,420px)!important;min-width:0!important;max-width:420px!important;max-height:min(85dvh,560px)!important;margin:auto!important;border-radius:20px!important;background:var(--dsw-alias-bg-layer-2)!important;box-shadow:var(--dsw-shadow-lv3)!important;display:flex!important;flex-direction:column!important;overflow-x:hidden!important;overflow-y:auto!important}
        body>div[role="presentation"]>[role="dialog"][aria-modal="true"]>*{min-width:0!important;min-height:0!important;max-width:100%!important}
        .ZuhsRW_dialog.ZuhsRW_dialog{box-sizing:border-box;width:min(92vw,420px)!important;max-width:420px!important;max-height:min(85dvh,560px)!important;min-height:0!important;margin:auto!important;border-radius:20px!important;display:flex!important;flex-direction:column!important;overflow-x:hidden!important;overflow-y:auto!important}
        .ZuhsRW_content,.ZuhsRW_millerRow,.ZuhsRW_column,[role="dialog"] [role="listbox"]{box-sizing:border-box!important;width:100%!important;min-width:0!important;min-height:0!important;display:flex!important}
        .ZuhsRW_content,.ZuhsRW_column,[role="dialog"] [role="listbox"]{flex-direction:column!important}
        .ZuhsRW_content,.ZuhsRW_millerRow{flex:1 1 0!important}
        .ZuhsRW_millerRow{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
        [role="dialog"][aria-modal="true"] label:has(input[type="checkbox"]){min-height:44px}
        /* 菜单容器：宿主的模型选择菜单是 display:flex + overflow:hidden，内部
           ._7KE1Ra_groups 才是真正的滚动区（min-height:0;overflow-y:auto）。
           这里若给容器也加 overflow-y:auto，容器自身在 max-height 内并不产生
           滚动（内容被 flex 子项撑满、子项自己滚），而 flex 布局下 overflow
           从 hidden 改成 auto 会重置 flex 子项的 min-height:auto 契约，导致
           内部滚动区被撑开、列表既不能滚动也被裁切——这正是「模型选择无法滚动」。
           正确做法是：容器保持 overflow:hidden，只让它内部的滚动区接手滚动。 */
        [role="menu"],:is(._7KE1Ra_menu,[class$="_menu"]),:is(._3e4SsG_menu,[class$="_menu"]){box-sizing:border-box!important;z-index:1300!important;max-width:calc(100vw - 24px)!important;max-height:min(360px,calc(var(--dsh-vvh,100dvh) - 120px))!important;border-radius:14px!important;box-shadow:var(--dsw-shadow-lv3)!important;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3))!important;border:1px solid var(--dsw-alias-border-l2)!important;overflow:hidden!important;overscroll-behavior:contain!important}
        /* 宿主模型菜单的内部滚动区：显式保活，避免被上面容器的 overflow 规则连带削弱 */
        ._7KE1Ra_groups{min-height:0!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important}
        span>[role="menu"]{position:absolute!important;bottom:calc(100% + 4px)!important;left:0!important;min-width:140px!important}
        body>[role="menu"]{min-width:180px!important}
        body>[role="menu"]:has(:is(.cubgiG_item,[class$="_item"])){width:min(300px,calc(100vw - 24px))!important}
        body>[role="menu"]:has(:is(.cubgiG_item,[class$="_item"])) [role="menuitem"]{box-sizing:border-box;min-height:56px;padding:8px 12px}
        body>[role="menu"] :is(.cubgiG_item,[class$="_item"]){max-width:none;min-width:0}
        body>[role="menu"] :is(.cubgiG_itemDesc,[class$="_itemDesc"]){overflow-wrap:anywhere}
        ._3e4SsG_menu{position:absolute!important;bottom:calc(100% + 4px)!important;left:0!important;right:auto!important;width:min(320px,calc(100vw - 24px))!important}
        ._3e4SsG_item{box-sizing:border-box;min-height:44px!important;padding:8px 12px!important}
        ._3e4SsG_itemName{max-width:50%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
        ._7KE1Ra_menu{position:fixed!important;top:auto!important;bottom:calc(64px + var(--dsh-keyboard-inset,0px) + var(--dsh-sab,0px))!important;right:12px!important;left:auto!important;width:min(280px,calc(100vw - 24px))!important;max-width:calc(100vw - 24px)!important;max-height:min(360px,calc(var(--dsh-vvh,100dvh) - 140px))!important;z-index:1400!important}
        ._7KE1Ra_option,._7KE1Ra_cell{box-sizing:border-box!important;width:100%!important;min-width:0!important}
        ._7KE1Ra_modelName,._7KE1Ra_description,._7KE1Ra_cellLabel,._7KE1Ra_cellValue{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
        ._7KE1Ra_cell{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:6px!important;max-width:100%!important;overflow:hidden!important}
        ._7KE1Ra_cellLabel{flex:none!important;max-width:40%!important;color:var(--dsw-alias-label-primary)!important;white-space:nowrap!important}
        ._7KE1Ra_cellValue{flex:1 1 auto!important;min-width:0!important;text-align:right!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
        ._7KE1Ra_cellChevron{flex:none!important}
        .VOzbGW_overlay{box-sizing:border-box;z-index:1100!important;position:fixed!important;inset:0!important;width:100vw;height:var(--dsh-vvh,100dvh)!important;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch}
        body>div[role="presentation"]:has(>:is(.VOzbGW_panel,[class$="_panel"])){box-sizing:border-box;z-index:1100!important;position:fixed!important;inset:0!important;width:100vw!important;height:var(--dsh-vvh,100dvh)!important;padding:0!important;background:var(--dsw-alias-bg-base)!important;display:flex!important;flex-direction:column!important;justify-content:flex-start!important;align-items:stretch!important}
        .VOzbGW_overlay,body>div[role="presentation"]:has(>[data-shortcut-modal="settings"]),body>div[role="presentation"]:has(>:is(.VOzbGW_panel,[class$="_panel"])){box-sizing:border-box;z-index:1100!important;position:fixed!important;inset:0!important;width:100vw;height:var(--dsh-vvh,100dvh)!important;padding:0!important;background:var(--dsw-alias-bg-base)!important;display:flex!important;flex-direction:column!important;justify-content:flex-start!important;align-items:stretch!important}
        .VOzbGW_mask{display:none!important}
        .VOzbGW_mask,[data-shortcut-modal="settings"]~[class*="_mask"]{display:none!important}
        .VOzbGW_panel{box-sizing:border-box;position:relative!important;inset:auto!important;width:100vw!important;height:100%!important;max-width:none!important;max-height:none!important;padding:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-base)!important;display:flex;flex-direction:column;overflow:hidden}
        .VOzbGW_panel,[data-shortcut-modal="settings"],body>div[role="presentation"]>[data-shortcut-modal="settings"],body>div[role="presentation"]>:is(.VOzbGW_panel,[class$="_panel"]),body>div[role="presentation"]>:is(.VOzbGW_panel,[class$="_panel"]){box-sizing:border-box;position:relative!important;inset:auto!important;width:100vw!important;height:100%!important;max-width:none!important;max-height:none!important;padding:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-base)!important;display:flex;flex-direction:column;overflow:hidden}
        body>div[role="presentation"]>[role="dialog"][aria-modal="true"]:is(.VOzbGW_panel,[class$="_panel"]){box-sizing:border-box;position:relative!important;inset:auto!important;width:100vw!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-base)!important;display:flex!important;flex-direction:column!important;overflow:hidden!important}
        body>div[role="presentation"]>[role="dialog"][aria-modal="true"]:is(.VOzbGW_panel,[class$="_panel"]),body>div[role="presentation"]>[role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]{box-sizing:border-box;position:relative!important;inset:auto!important;width:100vw!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-base)!important;display:flex!important;flex-direction:column!important;overflow:hidden!important}
        body>div[role="presentation"]>[role="dialog"][aria-modal="true"]:is(.VOzbGW_panel,[class$="_panel"])>*,body>div[role="presentation"]>[role="dialog"][aria-modal="true"]:is(.VOzbGW_panel,[class$="_panel"])>*,body>div[role="presentation"]>[role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]>*{max-width:none!important}
        /* 应用级浮层必须压过移动端顶栏。
           宿主的 [data-shell-overlay]（layout/AppFrame 的 overlayLayer）本身就是
           z-index:20 的 stacking context，里面写多大的 z-index 都出不来，于是
           .dsh-mobile-bar（900）会整条盖住抽屉头部、连关闭按钮都点不到。
           只能抬整层。
           选择器必须挂在语义属性上：CSS Module 类名随宿主构建变
           （pI_x6G_/BynINW_/…），旧写法 .pI_x6G_overlayLayer:has(.fv-scrim)
           在宿主升级换 hash 后整条失效，抽屉又被顶栏压住（2026-10 实测）。
           同时覆盖所有遮罩型浮层，而不是只认文件查看器：:has() 里匹配
           scrim/backdrop 任一类名，其它插件的全屏面板同样受益。
           注意：本段位于模板字符串内，注释里不能出现反引号。 */
        [data-slot="root"] :is([data-shell-overlay],[class$="_overlayLayer"]):has([class*="scrim"],[class*="backdrop"]){z-index:1100!important}
        /* dsh-file-viewer drawer. A 64vw panel is unusable on a phone, so it
           takes the whole screen. Height tracks the visual viewport instead of
           100dvh, which some mobile browsers report before the address bar
           settles, and both edges respect the safe-area insets. */
        .fv-scrim{box-sizing:border-box;z-index:1100!important;position:fixed!important;inset:0!important;width:100vw!important;height:var(--dsh-vvh,100dvh)!important;padding:0!important;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))!important;animation:none!important}
        .fv-shell{box-sizing:border-box;width:100vw!important;height:100%!important;max-width:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))!important;animation:none!important}
        .fv-head{box-sizing:border-box;flex:none;gap:4px!important;padding:calc(6px + var(--dsh-sat)) max(8px,var(--dsh-sar)) 6px max(8px,var(--dsh-sal))!important;justify-content:space-between!important;min-width:0;width:100%!important;overflow:hidden!important}
        .fv-title{display:none!important}
        .fv-root-select{flex:1 1 90px!important;min-width:70px!important;max-width:none!important}
        .fv-icon-button{width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;flex:none!important}
        .fv-btn-close{flex:none!important;margin-left:auto!important}
        .fv-tree,.fv-content{padding-bottom:max(12px,var(--dsh-sab))!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important}
        .fv-row{min-height:40px!important}
        .fv-pager{padding-bottom:max(8px,var(--dsh-sab))!important}
        .fv-pager .fv-button,.fv-note .fv-button{min-height:40px!important}
        .fv-table th,.fv-table td{max-width:60vw!important}
        .fv-float-entry{display:none!important}
        .VOzbGW_nav{box-sizing:border-box;width:100%!important;flex:none;gap:0!important;padding:calc(44px + var(--dsh-sat)) 0 0!important;display:flex;flex-direction:column}
        .VOzbGW_nav,[data-shortcut-modal="settings"]>nav{box-sizing:border-box;width:100%!important;flex:none!important;gap:0!important;padding:calc(44px + var(--dsh-sat)) 0 0!important;display:flex!important;flex-direction:column!important}
        .VOzbGW_navTitle{box-sizing:border-box;position:absolute;z-index:3;top:var(--dsh-sat);right:72px;left:72px;width:auto;height:44px;padding:0;color:var(--dsw-alias-label-primary);font-weight:600;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
        .VOzbGW_navTitle,[data-shortcut-modal="settings"]>nav>[class*="_navTitle"]{box-sizing:border-box;position:absolute;z-index:3;top:var(--dsh-sat);right:72px;left:72px;width:auto;height:44px;padding:0;color:var(--dsw-alias-label-primary);font-weight:600;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
        .VOzbGW_navList{box-sizing:border-box;width:100%!important;max-width:100%!important;height:44px;min-height:44px;margin:0!important;padding:4px max(12px,var(--dsh-sar)) 4px max(12px,var(--dsh-sal))!important;border-radius:0!important;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))!important;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.04))!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;gap:4px!important;overflow-x:auto!important;overflow-y:hidden;overscroll-behavior-x:contain;scroll-behavior:smooth;scrollbar-width:none!important;-webkit-overflow-scrolling:touch!important}
        .VOzbGW_navList::-webkit-scrollbar{display:none!important}
        .VOzbGW_navList,[data-shortcut-modal="settings"] [class*="_navList"]{box-sizing:border-box;width:100%!important;max-width:100%!important;height:44px;min-height:44px;margin:0!important;padding:4px max(12px,var(--dsh-sar)) 4px max(12px,var(--dsh-sal))!important;border-radius:0!important;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))!important;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.04))!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;gap:4px!important;overflow-x:auto!important;overflow-y:hidden;overscroll-behavior-x:contain;scroll-behavior:smooth;scrollbar-width:none!important;-webkit-overflow-scrolling:touch!important}
        .VOzbGW_navList::-webkit-scrollbar,[data-shortcut-modal="settings"] [class*="_navList"]::-webkit-scrollbar{display:none!important}
        .VOzbGW_navCell{box-sizing:border-box;flex:none;height:36px!important;min-width:44px;min-height:36px!important;padding:0 14px!important;border:0!important;border-radius:10px!important;background:transparent!important;color:var(--dsw-alias-label-tertiary)!important;font-size:13px!important;font-weight:500!important;line-height:18px;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;white-space:nowrap!important;transition:all .2s cubic-bezier(.4,0,.2,1)!important}
        .VOzbGW_navCell:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-secondary)!important}
        .VOzbGW_navCell:active{transform:scale(.98)}
        .VOzbGW_navCell:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
        .VOzbGW_navCell.VOzbGW_active{background:var(--dsw-alias-bg-layer-1,#fff)!important;color:var(--dsw-alias-label-primary)!important;font-weight:600!important;box-shadow:0 2px 8px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04)!important}
        .VOzbGW_navCell,[data-shortcut-modal="settings"] [class*="_navCell"]{box-sizing:border-box;flex:none;height:36px!important;min-width:44px;min-height:36px!important;padding:0 14px!important;border:0!important;border-radius:10px!important;background:transparent!important;color:var(--dsw-alias-label-tertiary)!important;font-size:13px!important;font-weight:500!important;line-height:18px;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;white-space:nowrap!important;transition:all .2s cubic-bezier(.4,0,.2,1)!important}
        .VOzbGW_navCell:hover,[data-shortcut-modal="settings"] [class*="_navCell"]:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-secondary)!important}
        .VOzbGW_navCell:active,[data-shortcut-modal="settings"] [class*="_navCell"]:active{transform:scale(.98)}
        .VOzbGW_navCell:focus-visible,[data-shortcut-modal="settings"] [class*="_navCell"]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
        .VOzbGW_navCell.VOzbGW_active,[data-shortcut-modal="settings"] [class*="_navCell"][class*="_active"],[data-shortcut-modal="settings"] [class*="_navCell"][aria-current="true"]{background:var(--dsw-alias-bg-layer-1,#fff)!important;color:var(--dsw-alias-label-primary)!important;font-weight:600!important;box-shadow:0 2px 8px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04)!important}
        .VOzbGW_navIcon{width:16px;height:16px;flex:none}
        .VOzbGW_navIcon,[data-shortcut-modal="settings"] [class*="_navIcon"]{width:16px;height:16px;flex:none}
        .VOzbGW_navLabel{min-width:0;flex:none;white-space:nowrap;overflow:visible}
        .VOzbGW_navLabel,[data-shortcut-modal="settings"] [class*="_navLabel"]{min-width:0;flex:none;white-space:nowrap;overflow:visible}
        .VOzbGW_content{width:100%;flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column}
        .VOzbGW_content,[data-shortcut-modal="settings"]>[class*="_content"]{width:100%!important;flex:1 1 0!important;min-width:0!important;min-height:0!important;display:flex!important;flex-direction:column!important}
        .VOzbGW_header{box-sizing:border-box;position:absolute;z-index:2;top:0;right:0;left:0;height:calc(44px + var(--dsh-sat))!important;min-height:calc(44px + var(--dsh-sat));padding:var(--dsh-sat) max(4px,var(--dsh-sar)) 0 max(4px,var(--dsh-sal))!important;border-bottom:0;background:var(--dsw-alias-bg-base);align-items:center!important;justify-content:space-between!important}
        .VOzbGW_header,[data-shortcut-modal="settings"] [class*="_header"]{box-sizing:border-box;position:absolute;z-index:2;top:0;right:0;left:0;height:calc(44px + var(--dsh-sat))!important;min-height:calc(44px + var(--dsh-sat));padding:var(--dsh-sat) max(4px,var(--dsh-sar)) 0 max(4px,var(--dsh-sal))!important;border-bottom:0;background:var(--dsw-alias-bg-base);align-items:center!important;justify-content:space-between!important}
        .VOzbGW_actions{max-width:calc(50vw - 52px);margin-left:0!important;overflow:hidden}
        .VOzbGW_actions,[data-shortcut-modal="settings"] [class*="_actions"]{max-width:calc(50vw - 52px);margin-left:0!important;overflow:hidden}
        .VOzbGW_close{width:44px!important;height:44px!important;min-width:44px;min-height:44px;border-radius:12px!important;background:transparent;flex:none}
        .VOzbGW_close:hover,.VOzbGW_close:active{background:var(--dsw-alias-interactive-bg-hover)}
        .VOzbGW_close,[data-shortcut-modal="settings"] [class*="_close"]{width:44px!important;height:44px!important;min-width:44px;min-height:44px;border-radius:12px!important;background:transparent;flex:none}
        .VOzbGW_close:hover,.VOzbGW_close:active,[data-shortcut-modal="settings"] [class*="_close"]:hover,[data-shortcut-modal="settings"] [class*="_close"]:active{background:var(--dsw-alias-interactive-bg-hover)}
        .VOzbGW_options{box-sizing:border-box;width:100%;flex:1 1 0;min-width:0;min-height:0;padding:4px max(16px,var(--dsh-sar)) max(24px,var(--dsh-sab)) max(16px,var(--dsh-sal))!important;background:var(--dsw-alias-bg-base);overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
        .VOzbGW_options,[data-shortcut-modal="settings"] [class*="_options"]{box-sizing:border-box;width:100%!important;flex:1 1 0!important;min-width:0!important;min-height:0!important;padding:4px max(16px,var(--dsh-sar)) max(24px,var(--dsh-sab)) max(16px,var(--dsh-sal))!important;background:var(--dsw-alias-bg-base);overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
        .VOzbGW_options :where(*,section,form,fieldset){min-width:0}
        .VOzbGW_options :where(*,section,form,fieldset),[data-shortcut-modal="settings"] [class*="_options"] :where(*,section,form,fieldset){min-width:0}
        .VOzbGW_options>[data-slot="settings.section"]>:has(>[data-slot="settings.general.item"]){box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
        .VOzbGW_options>[data-slot="settings.section"]>:has(>[data-slot="settings.general.item"]),[data-shortcut-modal="settings"] [class*="_options"]>[data-slot="settings.section"]>:has(>[data-slot="settings.general.item"]){box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
        .VOzbGW_options [data-slot="settings.general.item"]>*{box-sizing:border-box;min-height:72px;padding:14px 16px!important}
        .VOzbGW_options [data-slot="settings.general.item"]>*,[data-shortcut-modal="settings"] [class*="_options"] [data-slot="settings.general.item"]>*{box-sizing:border-box;min-height:72px;padding:14px 16px!important}
        .VOzbGW_options .oY77xG_row{flex-wrap:wrap}
        .VOzbGW_options [class*="_row"],[data-shortcut-modal="settings"] [class*="_options"] [class*="_row"]{flex-wrap:wrap}
        .VOzbGW_options .oY77xG_rowText{flex:1 1 120px;padding-right:8px!important}
        .VOzbGW_options [class*="_rowText"],[data-shortcut-modal="settings"] [class*="_options"] [class*="_rowText"]{flex:1 1 120px;padding-right:8px!important}
        .VOzbGW_options :where(input:not([type="checkbox"]):not([type="radio"]),select,textarea){box-sizing:border-box;min-width:0!important;max-width:100%!important;min-height:44px!important;border-radius:12px!important;font-size:16px!important}
        .VOzbGW_options :where(input:not([type="checkbox"]):not([type="radio"]),select,textarea),[data-shortcut-modal="settings"] [class*="_options"] :where(input:not([type="checkbox"]):not([type="radio"]),select,textarea){box-sizing:border-box;min-width:0!important;max-width:100%!important;min-height:44px!important;border-radius:12px!important;font-size:16px!important}
        .VOzbGW_options :where(button,[role="button"],[role="switch"],summary){min-width:44px;min-height:44px;touch-action:manipulation}
        .VOzbGW_options :where(button,[role="button"],[role="switch"],summary),[data-shortcut-modal="settings"] [class*="_options"] :where(button,[role="button"],[role="switch"],summary){min-width:44px;min-height:44px;touch-action:manipulation}
        .VOzbGW_options .dm-container :where(button,[role="button"],.dm-action-btn,.dm-tab-btn,.dm-filter-btn,.dm-chip,.dm-icon-mini-btn){min-width:0;min-height:0}
        .VOzbGW_options .dm-container :where(button,[role="button"],.dm-action-btn,.dm-tab-btn,.dm-filter-btn,.dm-chip,.dm-icon-mini-btn),[data-shortcut-modal="settings"] .dm-container :where(button,[role="button"],.dm-action-btn,.dm-tab-btn,.dm-filter-btn,.dm-chip,.dm-icon-mini-btn){min-width:0;min-height:0}
        .VOzbGW_options input[type="range"]{height:44px!important}
        .VOzbGW_options input[type="range"],[data-shortcut-modal="settings"] [class*="_options"] input[type="range"]{height:44px!important}
        .VOzbGW_options label:has(input:is([type="checkbox"],[type="radio"])){min-height:44px}
        .VOzbGW_options label:has(input:is([type="checkbox"],[type="radio"])),[data-shortcut-modal="settings"] [class*="_options"] label:has(input:is([type="checkbox"],[type="radio"])){min-height:44px}
        @keyframes dsh-mobile-pulse{from{opacity:.45}to{opacity:1}}
        @keyframes dsh-mobile-detail-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
      }
      @media (prefers-reduced-motion:reduce){
        [data-slot="root"]>div>div:has(>[data-slot="sidebar"]),[data-slot="root"]>div>div:has(>[data-slot="details"]){transition:none}
        .Y0dWHa_details{animation:none}
        .dsh-mobile-status[data-running=true]:before{animation:none}
        .VOzbGW_navCell{transition:none}
      }
    `

    const PERMISSION_I18N = {
      'workspace-write': '工作区写入',
      'Workspace Write': '工作区写入',
      'read-only': '只读',
      'Read Only': '只读',
      'danger-full-access': '完全访问',
      'Full access': '完全访问',
      'Full Access': '完全访问',
      'custom': '自定义',
      'Custom': '自定义',
    }

    function localizePermission(text) {
      if (!text) return ''
      return PERMISSION_I18N[text] || text
    }

    function localizeDomPermissions(doc) {
      try {
        // 1. 输入栏权限按钮文案
        const labels = doc.querySelectorAll('.Sh0Q9G_triggerLabel, .iWlSmW_triggerLabel, [data-composer-card] button[class*="triggerLabel"]')
        for (const el of labels) {
          const t = el.textContent?.trim()
          if (t && PERMISSION_I18N[t]) el.textContent = PERMISSION_I18N[t]
        }
        // 2. 设置页面中的权限选择器按钮文案
        const selectors = doc.querySelectorAll('.oY77xG_selector, [data-slot*="permission"] select, [data-slot*="permission"] button')
        for (const el of selectors) {
          const child = el.firstChild
          if (child && child.nodeType === 3) {
            const t = child.nodeValue?.trim()
            if (t && PERMISSION_I18N[t]) child.nodeValue = PERMISSION_I18N[t] + ' '
          }
        }
        // 3. 弹出的权限选项菜单
        const menuItems = doc.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] li, [role="menu"] span')
        for (const el of menuItems) {
          if (el.children.length === 0) {
            const t = el.textContent?.trim()
            if (t && PERMISSION_I18N[t]) el.textContent = PERMISSION_I18N[t]
          }
        }
      } catch (_) {}
    }

    function titleOf(doc) {
      const crumbCurrent = doc.querySelector('.wSkVaW_crumbCurrent, [class*="_crumbCurrent"]')
      const currentText = crumbCurrent?.textContent?.trim()
      if (currentText) return currentText

      const crumbs = doc.querySelectorAll('.wSkVaW_crumb, [class*="_crumb"]')
      if (crumbs.length > 0) {
        const lastCrumbText = crumbs[crumbs.length - 1]?.textContent?.trim()
        if (lastCrumbText) return lastCrumbText
      }

      const current = doc.querySelector('[data-slot="conversation.session.header"] nav button:disabled')
      return current?.textContent?.trim() || '新会话'
    }

    function statusOf(doc) {
      const running = doc.querySelector('[data-composer-card] button[aria-label^="停止"], [data-composer-card] button[aria-label^="Stop"]') != null
      const base = running ? '运行中' : doc.querySelector('[data-slot="conversation"]>[data-phase="hero"]') ? '新会话' : '就绪'
      const preset = (doc.querySelector('[data-slot="conversation.session.header"] .SVAs4q_label')
        || doc.querySelector('[data-slot="conversation.hero.agentPreset"]'))?.textContent?.trim().replace(/\s+/g, ' ')
      const permissionTrigger = doc.querySelector('.Sh0Q9G_trigger, .iWlSmW_trigger, [data-composer-card] button[aria-label*="权限"], [data-composer-card] button[aria-label*="permission" i]')
      const rawPermission = doc.querySelector('.Sh0Q9G_triggerLabel, .iWlSmW_triggerLabel')?.textContent?.trim()
        || permissionTrigger?.textContent?.trim()
        || permissionTrigger?.getAttribute('aria-label')?.replace(/^(?:权限|permission)\s*[:：]?\s*/i, '').trim()
      const permission = localizePermission(rawPermission)
      const placeholder = doc.querySelector('[data-composer-card] textarea')?.getAttribute('placeholder') || ''
      const plan = doc.querySelector('.rS3zOq_chip') != null || /(计划|plan)/i.test(placeholder)
      return {
        text: [base, preset, base === '新会话' ? '' : permission].filter(Boolean).join(' · ') + (plan ? ' [计划]' : ''),
        running,
        plan,
        preset,
      }
    }

    /**
     * 把输入框下方的 dock（「N 轮 M 步 · tokens/s」「用量 · 缓存命中」统计行 +
     * 上下文用量圆环）收回输入卡片内部。
     *
     * 宿主把 dock 渲染成卡片的下一个兄弟节点，视觉上落在卡片外下方；移动端要让它
     * 出现在卡片圆角内，只能靠「卡片补底部内边距 + dock 负边距上移」这一对配平。
     * 旧实现用 `:has(+dock :is(...))` 选择器 + 固定 40px / -38px 魔法数，有两个
     * 静默失效的场景：
     *   1. 浏览器不支持 :has()（Safari < 15.4、Chrome < 105、部分移动端内核），
     *      整条规则不生效，圆环掉回卡片外——用户看到的就是「输入框下方的内容缺失」；
     *   2. 宿主换代后 meter 尺寸变化或统计行折行，固定的魔法数不再配平。
     * 这里改为测量 dock 的真实高度写进 --dsh-dock-reserve，卡片底部内边距与 dock
     * 负边距同时引用它，任何折行/尺寸变化都能自动对齐。
     *
     * @param {Document} doc - 宿主文档。
     * @param {boolean} mobile - 当前是否移动端视口。
     */
    function balanceComposerDock(doc, mobile) {
      const card = typeof doc?.querySelector === 'function' ? doc.querySelector('[data-composer-card]') : null
      const dock = card?.nextElementSibling ?? null
      const classes = typeof dock?.className === 'string' ? dock.className : ''
      const isDock = dock != null
        && (dock.hasAttribute?.('data-composer-dock') === true || /(?:^|\s)\S*_dock(?:\s|$)/.test(classes))
      // 计划复核/待办面板需要完整纵向空间，负边距会把它和输入区叠在一起。
      const planOpen = isDock && typeof dock.querySelector === 'function'
        ? dock.querySelector('[data-plan-review-scroll],[data-plan-review-key]') != null
        : false
      const reset = () => {
        if (card != null) {
          card.removeAttribute?.('data-dsh-dock-reserve')
          card.style?.removeProperty?.('--dsh-dock-reserve')
        }
        if (dock != null) {
          dock.removeAttribute?.('data-dsh-dock')
          dock.removeAttribute?.('data-dsh-dock-balanced')
          dock.style?.removeProperty?.('--dsh-dock-reserve')
        }
      }
      if (!mobile || card == null || !isDock || planOpen) {
        reset()
        return
      }
      // 先进入配平态再量高度：配平态把 dock 的内边距从 2px/0 换成 0/6px，
      // 先量未配平态会少算 4px，dock 底部就会从卡片边缘探出去。加属性与写变量
      // 在同一个同步任务里完成，浏览器不会绘制中间帧。
      // 脚本识别出的 dock 只用自己的 data 标记驱动样式：宿主的类名/属性各版本不同，
      // 旧宿主（例如桌面版的 Qt4Hga_dock）既没有 data-composer-dock，也不叫 ccegLa_dock，
      // 只按类名写 CSS 会让「JS 认得出的 dock」拿不到配平样式。
      if (dock.hasAttribute?.('data-dsh-dock') !== true) dock.setAttribute?.('data-dsh-dock', '')
      if (card.hasAttribute?.('data-dsh-dock-reserve') !== true) card.setAttribute?.('data-dsh-dock-reserve', '')
      if (dock.hasAttribute?.('data-dsh-dock-balanced') !== true) dock.setAttribute?.('data-dsh-dock-balanced', '')
      // dock 的高度不受自身 margin 影响，直接量即可（border-box，含 padding）。
      const rect = typeof dock.getBoundingClientRect === 'function' ? dock.getBoundingClientRect() : null
      const height = Math.round(rect?.height ?? 0)
      if (!(height > 0)) {
        reset()
        return
      }
      const reserve = `${height}px`
      if (card.style?.getPropertyValue?.('--dsh-dock-reserve') !== reserve) card.style?.setProperty?.('--dsh-dock-reserve', reserve)
      if (dock.style?.getPropertyValue?.('--dsh-dock-reserve') !== reserve) dock.style?.setProperty?.('--dsh-dock-reserve', reserve)
    }

    function mount(ctx, doc = document, win = window) {
      if (doc.getElementById('dsh-mobile-adapter-style')) return () => {}

      const style = doc.createElement('style')
      style.id = 'dsh-mobile-adapter-style'
      style.dataset.plugin = 'dsh-mobile-adapter'
      style.textContent = css

      const bar = doc.createElement('header')
      bar.className = 'dsh-mobile-bar'
      bar.setAttribute('aria-label', '移动端导航')

      const menu = doc.createElement('button')
      menu.type = 'button'
      menu.className = 'dsh-mobile-icon'
      menu.setAttribute('aria-label', '打开会话侧栏')
      menu.setAttribute('aria-controls', 'dsh-mobile-drawer')
      menu.textContent = '☰'

      const titleBox = doc.createElement('div')
      titleBox.className = 'dsh-mobile-titlebox'
      const title = doc.createElement('div')
      title.className = 'dsh-mobile-title'
      const status = doc.createElement('div')
      status.className = 'dsh-mobile-status'
      titleBox.append(title, status)

      const view = doc.createElement('button')
      view.type = 'button'
      view.className = 'dsh-mobile-view'

      // 顶栏右侧的「操作下拉」按钮：把原本平铺在顶栏上的四个入口收进来。
      const menuToggle = doc.createElement('button')
      menuToggle.type = 'button'
      menuToggle.className = 'dsh-mobile-menu-toggle'
      menuToggle.setAttribute('aria-label', '更多操作')
      menuToggle.setAttribute('aria-haspopup', 'menu')
      menuToggle.setAttribute('aria-expanded', 'false')
      menuToggle.title = '更多操作'
      menuToggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

      const menuBackdrop = doc.createElement('div')
      menuBackdrop.className = 'dsh-mobile-menu-backdrop'
      menuBackdrop.hidden = true

      const menuPanel = doc.createElement('div')
      menuPanel.className = 'dsh-mobile-menu-panel'
      menuPanel.setAttribute('role', 'menu')
      menuPanel.setAttribute('aria-label', '更多操作')
      menuPanel.hidden = true

      const closeMenuPanel = () => {
        if (menuPanel.hidden) return
        menuPanel.hidden = true
        menuBackdrop.hidden = true
        menuToggle.setAttribute('aria-expanded', 'false')
      }

      // 面板的全局关闭：Esc、页面滚动、视口变化都要收起。
      // 面板是 fixed 定位、锚点写死像素值，页面一滚就会与按钮错位，
      // 那时它既不在按钮下方、又挡着内容——必须关掉而不是跟随。
      // 用可选调用（?.）而不是直接调用：单测的 window 桩只有部分方法，
      // 直接写 win.addEventListener 会在沙箱里抛 TypeError，让整条用例失败。
      doc.addEventListener?.('keydown', (e) => {
        if (e.key === 'Escape' && !menuPanel.hidden) closeMenuPanel()
      }, true)
      win.addEventListener?.('scroll', () => closeMenuPanel(), { passive: true, capture: true })
      win.addEventListener?.('resize', () => closeMenuPanel(), { passive: true })

      /** 造一个面板条目：图标 + 文案 + 点击回调。 */
      const menuItem = (iconSvg, label, onClick) => {
        const item = doc.createElement('button')
        item.type = 'button'
        item.className = 'dsh-mobile-menu-item'
        item.setAttribute('role', 'menuitem')
        item.innerHTML = `<span class="dsh-mobile-menu-item-icon">${iconSvg}</span><span class="dsh-mobile-menu-item-label">${label}</span>`
        // data-label 同时是测试断言点与无障碍兜底：DOM 桩可能没实现 lastChild，
        // 但属性读取在所有实现里都可靠。
        item.setAttribute('data-label', label)
        // 按下只拦冒泡、不做动作——与工具箱同一套手势约定：
        // 若在 pointerdown 就关面板，手指抬起时的 click 会落到下面的输入框上。
        const hold = (e) => e.stopPropagation()
        item.addEventListener('pointerdown', hold)
        item.addEventListener('touchstart', hold, { passive: true })
        item.addEventListener('click', (e) => {
          e?.stopPropagation?.()
          closeMenuPanel()
          onClick()
        })
        return item
      }

      // 面板内的三个入口（可见性由 sync 统一维护）
      const menuItemView = menuItem(
        '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h3l2-4 2 8 2-4h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        '查看轨迹',
        () => view.click(),
      )

      const menuItemCorner = menuItem(
        '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M10 2v12"/></svg>',
        '右侧面板',
        () => cornerBtn.click(),
      )

      // 「新建工作区」：宿主把入口放在侧栏「工作区」标题行的 + 按钮上，
      // 该按钮没有稳定的 CSS Module 部件名（fixture 里查不到），
      // 因此按 aria-label / title 语义定位——这是宿主写死的属性，跨构建稳定。
      const menuItemNewWorkspace = menuItem(
        '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h2.6l1.2 1.5h5.2A1.5 1.5 0 0 1 14 7v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z" stroke="currentColor" stroke-width="1.3"/><path d="M8 8.2v3.2M6.4 9.8h3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        '新建工作区',
        () => {
          const target = doc.querySelector(
            'button[aria-label*="新建工作区"], button[title*="新建工作区"], button[aria-label*="New workspace" i], button[title*="New workspace" i], button[aria-label*="添加工作区"], button[title*="添加工作区"]',
          )
          if (target && typeof target.click === 'function') target.click()
        },
      )

      const menuSep = doc.createElement('div')
      menuSep.className = 'dsh-mobile-menu-sep'

      // 面板条目：轨迹与对话切换 / 新建工作区 / 右侧侧边栏。
      // 「会话侧栏」不在这里——它已经是顶栏左侧的 ☰，重复入口只是噪音。
      menuPanel.append(menuItemView, menuItemNewWorkspace, menuItemCorner)

      const actionsBtn = doc.createElement('button')
      actionsBtn.type = 'button'
      actionsBtn.className = 'dsh-mobile-btn dsh-mobile-actions-btn'
      actionsBtn.setAttribute('aria-label', '会话操作')
      actionsBtn.title = '更多会话操作'
      actionsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>'
      actionsBtn.hidden = true

      const cornerBtn = doc.createElement('button')
      cornerBtn.type = 'button'
      cornerBtn.className = 'dsh-mobile-btn dsh-mobile-corner-btn'
      cornerBtn.setAttribute('aria-label', '切换右侧面板')
      cornerBtn.title = '切换右侧面板（项目文件 / 终端）'
      cornerBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M10 2v12"/></svg>'
      cornerBtn.hidden = true

      // 全屏切换：进入后收起浏览器 chrome；按钮停在顶栏右侧。
      const fullscreenToggle = doc.createElement('button')
      fullscreenToggle.type = 'button'
      fullscreenToggle.className = 'dsh-mobile-fullscreen-toggle'
      fullscreenToggle.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5.6V2.6h3M14 5.6V2.6h-3M2 10.4v3h3M14 10.4v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

      // 顶栏可见项：☰ 侧栏（标题左侧） + 标题 + 操作下拉 + 全屏。
      // 轨迹 / 会话操作 / 右侧面板三项收进下拉面板，但它们的原始节点仍挂在
      // bar 里并标记 hidden——作为面板的**点击代理目标**，让 sync() 继续维护
      // 文案与可用性，不必改动任何既有的事件与状态契约。CSS 里统一 display:none。
      //
      // ☰ 之所以保留在顶栏而不收进面板：它是「打开会话侧栏」这个最高频的
      // 导航动作，藏进二级菜单会让每次切换会话都多两次点击。
      menu.hidden = false
      view.hidden = true
      actionsBtn.hidden = true
      cornerBtn.hidden = true
      bar.append(menu, titleBox, menuToggle, fullscreenToggle, view, actionsBtn, cornerBtn)

      titleBox.addEventListener('click', () => {
        const target = doc.querySelector('.wSkVaW_crumbCurrent, [class*="_crumbCurrent"], [data-slot="conversation.session.header.lineage"] button, [class*="_crumb"]:last-of-type')
        if (target && typeof target.click === 'function') target.click()
      })

      actionsBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const target = doc.querySelector('.wSkVaW_headerUtilities button, [class*="_headerUtilities"] button, .wSkVaW_headerActions button, [class*="_headerActions"] button')
        if (!target) return
        try {
          const rect = actionsBtn.getBoundingClientRect()
          const prevPos = target.style.position
          const prevTop = target.style.top
          const prevLeft = target.style.left
          const prevZ = target.style.zIndex
          target.style.position = 'fixed'
          target.style.top = `${Math.round(rect.bottom + 4)}px`
          target.style.left = `${Math.round(rect.left)}px`
          target.style.zIndex = '9999'
          target.click()
          win.requestAnimationFrame(() => {
            target.style.position = prevPos
            target.style.top = prevTop
            target.style.left = prevLeft
            target.style.zIndex = prevZ
          })
        } catch (_) {
          target.click()
        }
      })

      cornerBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const target = doc.querySelector('.wSkVaW_headerCorner button, [class*="_headerCorner"] button, [data-conversation-header-corner] button')
        if (target && typeof target.click === 'function') {
          target.click()
        } else if (typeof ctx?.layout?.openRightbar === 'function') {
          if (isRightbarOpen()) ctx.layout.closeRightbar?.()
          else ctx.layout.openRightbar?.(false, true)
        }
      })

      const backdrop = doc.createElement('button')
      backdrop.type = 'button'
      backdrop.className = 'dsh-mobile-backdrop'
      backdrop.setAttribute('aria-label', '关闭会话侧栏')
      backdrop.hidden = true

      const fileInput = doc.createElement('input')
      fileInput.type = 'file'
      fileInput.multiple = true
      fileInput.style.display = 'none'
      fileInput.setAttribute('aria-hidden', 'true')

      const uploadBtn = doc.createElement('button')
      uploadBtn.type = 'button'
      uploadBtn.className = 'dsh-mobile-upload-btn'
      uploadBtn.setAttribute('aria-label', '添加附件')
      uploadBtn.title = '添加附件'
      uploadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z" fill="currentColor"/></svg>'

      const infoEl = doc.createElement('div')
      infoEl.className = 'dsh-mobile-composer-info'
      infoEl.setAttribute('aria-live', 'polite')

      const dispatchImages = (files) => {
        if (!files || !files.length) return
        const dt = typeof win.DataTransfer === 'function' ? new win.DataTransfer() : null
        if (!dt) return
        for (const f of files) dt.items?.add ? dt.items.add(f) : null
        // 只派发 drop：DSH 在 document 上原生监听 drop 并 intake 图片，
        // 同时派发 paste 会让同一批图片被两个入口各添加一次（重复上传）。
        const dropEv = typeof win.DragEvent === 'function'
          ? new win.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
          : new win.Event('drop', { bubbles: true, cancelable: true })
        if (!dropEv.dataTransfer) dropEv.dataTransfer = dt
        doc.dispatchEvent(dropEv)
      }

      uploadBtn.addEventListener('click', () => {
        const nativeFileInput = doc.querySelector('[data-composer-card] input[type="file"]')
        if (nativeFileInput && nativeFileInput !== fileInput) {
          nativeFileInput.click()
        } else {
          fileInput.click()
        }
      })

      fileInput.addEventListener('change', () => {
        const files = [...(fileInput.files || [])]
        if (files.length) dispatchImages(files)
        fileInput.value = ''
      })

      const toolsBtn = doc.createElement('button')
      toolsBtn.type = 'button'
      toolsBtn.className = 'dsh-mobile-tools-btn'
      toolsBtn.setAttribute('aria-label', '工作区工具')
      toolsBtn.title = '工作区工具（文件查看器 / 本地终端）'
      toolsBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5h5v5H2zM9 2.5h5v5H9zM2 9.5h5v5H2zM9 9.5h5v5H9z" fill="currentColor"/></svg>'

      const toolsBackdrop = doc.createElement('div')
      toolsBackdrop.className = 'dsh-mobile-tools-backdrop'
      toolsBackdrop.hidden = true

      const toolsMenu = doc.createElement('div')
      toolsMenu.className = 'dsh-mobile-tools-menu'
      toolsMenu.setAttribute('role', 'menu')
      toolsMenu.setAttribute('aria-label', '工作区工具')
      toolsMenu.hidden = true

      const closeToolsMenu = () => {
        toolsMenu.hidden = true
        toolsBackdrop.hidden = true
      }

      // 打开动作放到 setTimeout(0)：pointerdown 事件完全结束后再触发 React 状态更新，
      // 否则部分移动端浏览器会因事件中断而丢失 openStore.set 引发的重渲染。
      const invokeOpen = (fn) => {
        setTimeout(() => {
          try {
            if (typeof fn === 'function') fn()
            else if (typeof win.__dsh_open_file_viewer === 'function') win.__dsh_open_file_viewer()
            else if (typeof win.__dsh_open_terminal === 'function') win.__dsh_open_terminal()
          } catch (_) {}
        }, 0)
      }
      const openFileViewer = () => {
        closeToolsMenu()
        invokeOpen(win.__dsh_open_file_viewer)
      }

      const openTerminal = () => {
        closeToolsMenu()
        invokeOpen(win.__dsh_open_terminal)
      }

      const openPromptHistory = () => {
        closeToolsMenu()
        invokeOpen(win.__dsh_open_prompt_history)
      }

      /** 打开/关闭顶栏「更多操作」下拉面板。 */
      const toggleMenuPanel = (e) => {
        e?.stopPropagation()
        if (!menuPanel.hidden) {
          closeMenuPanel()
          return
        }
        // 可见性**不再**在这里重算。
        //
        // 曾经的写法是 `menuItemView.hidden = view.hidden`，但 view / actionsBtn /
        // cornerBtn 这三个代理节点已被 sync() 永久设为 hidden（它们不在顶栏上显示），
        // 于是每次打开面板都会把全部条目一起隐藏——用户看到的就是「面板里
        // 三个按钮都没加载，只剩一个多余的会话侧栏」。
        //
        // 正确做法：条目可见性由 sync() 独立维护（见那边的 menuItem* 赋值），
        // 这里只负责打开面板。轨迹项的文案也由 sync() 同步，避免两处各写一份。
        menuSep.hidden = menuItemNewWorkspace.hidden && menuItemCorner.hidden

        // 定位：贴在按钮正下方、右边缘对齐，并钳制在视口内
        const rect = menuToggle.getBoundingClientRect()
        menuPanel.style.setProperty('--dsh-menu-anchor-top', `${Math.round(rect.bottom + 6)}px`)
        const panelWidth = 220
        const left = Math.min(Math.max(8, rect.right - panelWidth), (win.innerWidth || 360) - panelWidth - 8)
        menuPanel.style.setProperty('--dsh-menu-anchor-left', `${Math.round(left)}px`)

        menuPanel.hidden = false
        menuBackdrop.hidden = false
        menuToggle.setAttribute('aria-expanded', 'true')
      }

      menuToggle.addEventListener('click', toggleMenuPanel)
      menuBackdrop.addEventListener('click', () => closeMenuPanel())

      const toggleToolsMenu = (e) => {
        e?.stopPropagation()
        const hasFv = typeof win.__dsh_open_file_viewer === 'function' || doc.querySelector('button[aria-label="查看项目文件"], button[title="查看项目文件"]') != null
        const hasTerm = typeof win.__dsh_open_terminal === 'function' || doc.querySelector('button[aria-label="打开本地终端"], button[title="打开本地终端"]') != null
        const hasPh = typeof win.__dsh_open_prompt_history === 'function' || doc.querySelector('button[aria-label="提示词历史"], button[title="提示词历史"]') != null

        const activeTools = []
        if (hasFv) activeTools.push(openFileViewer)
        if (hasTerm) activeTools.push(openTerminal)
        if (hasPh) activeTools.push(openPromptHistory)

        if (activeTools.length === 1) {
          activeTools[0]()
          return
        }

        if (!toolsMenu.hidden) {
          closeToolsMenu()
          return
        }

        while (toolsMenu.firstChild) toolsMenu.removeChild(toolsMenu.firstChild)

        // 关键：绝不能在 pointerdown 阶段关闭菜单。
        // 一旦在按下时就隐藏菜单与遮罩，手指抬起时该坐标下已经换成了输入框，
        // 合成出的 click 会落到输入框上（表现为“还没点到选项面板就消失、点终端
        // 结果点进了输入框”）。因此按下只拦冒泡、不做任何事，动作留给 click。
        const holdGesture = (e) => e.stopPropagation()
        const runItem = (e, action) => {
          e.stopPropagation()
          action()
        }

        if (hasFv) {
          const itemFv = doc.createElement('button')
          itemFv.type = 'button'
          itemFv.className = 'dsh-mobile-tools-item'
          itemFv.setAttribute('role', 'menuitem')
          itemFv.innerHTML = '<span class="dsh-mobile-tools-icon">📁</span><span>文件查看器</span>'
          itemFv.addEventListener('pointerdown', holdGesture)
          itemFv.addEventListener('touchstart', holdGesture, { passive: true })
          itemFv.addEventListener('click', (e) => runItem(e, openFileViewer))
          toolsMenu.append(itemFv)
        }

        if (hasTerm) {
          const itemTerm = doc.createElement('button')
          itemTerm.type = 'button'
          itemTerm.className = 'dsh-mobile-tools-item'
          itemTerm.setAttribute('role', 'menuitem')
          itemTerm.innerHTML = '<span class="dsh-mobile-tools-icon" style="font-family:monospace;font-weight:700">&gt;_</span><span>本地终端</span>'
          itemTerm.addEventListener('pointerdown', holdGesture)
          itemTerm.addEventListener('touchstart', holdGesture, { passive: true })
          itemTerm.addEventListener('click', (e) => runItem(e, openTerminal))
          toolsMenu.append(itemTerm)
        }

        if (hasPh) {
          const itemPh = doc.createElement('button')
          itemPh.type = 'button'
          itemPh.className = 'dsh-mobile-tools-item'
          itemPh.setAttribute('role', 'menuitem')
          itemPh.innerHTML = '<span class="dsh-mobile-tools-icon">🕒</span><span>提示词历史</span>'
          itemPh.addEventListener('pointerdown', holdGesture)
          itemPh.addEventListener('touchstart', holdGesture, { passive: true })
          itemPh.addEventListener('click', (e) => runItem(e, openPromptHistory))
          toolsMenu.append(itemPh)
        }

        if (toolsMenu.children.length > 0) {
          // 兜底定位：默认贴在按钮上方、右边缘对齐，避免定位失败导致菜单不可见
          toolsMenu.style.setProperty('--dsh-tools-anchor-top', 'auto')
          toolsMenu.style.setProperty('--dsh-tools-anchor-left', 'auto')
          toolsMenu.style.bottom = ''
          toolsMenu.style.right = ''
          toolsMenu.hidden = false
          toolsBackdrop.hidden = false
          // 等菜单渲染后再精确定位（rAF），并钳制在视口内
          try {
            win.requestAnimationFrame(() => {
              const rect = toolsBtn.getBoundingClientRect()
              const vw = win.innerWidth || 0
              const menuW = toolsMenu.offsetWidth || 180
              const menuH = toolsMenu.offsetHeight || 96
              const gap = 8
              const left = Math.max(12, Math.min(rect.left || 0, vw - menuW - 12))
              let top = (rect.top || 0) - menuH - gap
              const vh = (win.visualViewport && win.visualViewport.height) || win.innerHeight || 0
              if (top < 12) top = Math.min((rect.bottom || 0) + gap, Math.max(12, vh - menuH - 12))
              toolsMenu.style.setProperty('--dsh-tools-anchor-top', Math.round(top) + 'px')
              toolsMenu.style.setProperty('--dsh-tools-anchor-left', Math.round(left) + 'px')
            })
          } catch (_) {}
        }
      }

      toolsBtn.addEventListener('click', toggleToolsMenu)
      // 菜单容器自身拦截指针事件冒泡，杜绝 doc 级监听器误关闭
      toolsMenu.addEventListener('pointerdown', (e) => e.stopPropagation())
      toolsMenu.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
      toolsMenu.addEventListener('click', (e) => e.stopPropagation())
      // backdrop 仅用 click 关闭：pointerdown/touchstart 关闭会让“点菜单项”手势穿透误关
      toolsBackdrop.addEventListener('click', closeToolsMenu)

      doc.head.append(style)
      doc.body.append(bar, backdrop, fileInput, toolsBackdrop, toolsMenu, menuBackdrop, menuPanel)

      const media = win.matchMedia(MOBILE_QUERY)
      const frameOf = () => doc.querySelector('[data-slot="root"]>div')
      const sidebarOf = () => doc.querySelector('[data-slot="sidebar"]')?.parentElement
      const tabsOf = () => [...doc.querySelectorAll('[data-slot="conversation.session.header"] [role="tablist"] [role="tab"]')]
      const trajectoryOf = () => tabsOf().find((tab) => /^(轨迹|Trajectory)$/i.test(tab.textContent?.trim()))
      const chatOf = () => tabsOf().find((tab) => tab !== trajectoryOf())
      const isOpen = () => media.matches && frameOf()?.hasAttribute('data-sidebar-collapsed') === false
      let previousOpen = false

      const sync = () => {
        const mobile = media.matches
        // 视口变宽（旋转到平板/桌面）时全屏失去意义：顶栏本来就不占位，
        // 停在「隐藏顶栏」状态会让用户找不到菜单入口，这里静默退回。
        if (!mobile && fullscreen) applyFullscreen(false)
        const open = isOpen()
        const sidebar = sidebarOf()
        const state = statusOf(doc)
        const trajectory = trajectoryOf()
        const inTrajectory = trajectory?.getAttribute('aria-selected') === 'true'
        bar.hidden = !mobile
        const nextTitle = titleOf(doc)
        if (title.textContent !== nextTitle) title.textContent = nextTitle
        if (status.textContent !== state.text) status.textContent = state.text
        status.dataset.running = state.running ? 'true' : 'false'
        status.dataset.plan = state.plan ? 'true' : 'false'
        status.dataset.preset = state.preset || ''
        localizeDomPermissions(doc)
        const inRightbar = isRightbarOpen()
        // 这些节点已不在顶栏上显示（仅作为面板的点击代理），始终保持隐藏。
        view.hidden = true
        const nextViewText = inRightbar ? '← 对话' : inTrajectory ? '← 对话' : '⌁ 轨迹'
        if (view.textContent !== nextViewText) view.textContent = nextViewText
        const nextViewLabel = inRightbar ? '收起右侧面板，返回对话' : inTrajectory ? '关闭轨迹，返回对话' : '查看轨迹'
        if (view.getAttribute('aria-label') !== nextViewLabel) view.setAttribute('aria-label', nextViewLabel)
        // —— 下拉面板条目的可见性与文案，全部在这里统一维护 ——
        //
        // 这是**唯一**维护点。toggleMenuPanel 只负责开关面板，不再重算可见性
        // （曾经两处各算一份，结果一边把代理节点的 hidden 当成「不可用」，
        // 打开面板时把所有条目一起隐藏了）。
        //
        // 轨迹项：宿主存在轨迹页签即可用；在轨迹里时文案变「返回对话」。
        const hasTrajectory = trajectory != null || inRightbar
        menuItemView.hidden = !mobile || !hasTrajectory
        const nextPanelViewLabel = inRightbar || inTrajectory ? '返回对话' : '查看轨迹'
        if (menuItemView.getAttribute('data-label') !== nextPanelViewLabel) {
          menuItemView.setAttribute('data-label', nextPanelViewLabel)
          if (menuItemView.lastChild) menuItemView.lastChild.textContent = nextPanelViewLabel
        }

        // 新建工作区：宿主有对应入口按钮时才显示（按 aria-label 语义定位）。
        const nativeNewWorkspace = doc.querySelector(
          'button[aria-label*="新建工作区"], button[title*="新建工作区"], button[aria-label*="New workspace" i], button[title*="New workspace" i], button[aria-label*="添加工作区"], button[title*="添加工作区"]',
        )
        menuItemNewWorkspace.hidden = !mobile || nativeNewWorkspace == null

        // 右侧侧边栏：宿主有 headerCorner 按钮时才显示。
        const nativeCorner = doc.querySelector('.wSkVaW_headerCorner button, [class*="_headerCorner"] button, [data-conversation-header-corner] button')
        cornerBtn.hidden = true
        menuItemCorner.hidden = !mobile || nativeCorner == null

        // 会话操作仍是代理节点（面板里不再列它），sync 继续维护它的可用性。
        const nativeActions = doc.querySelector('.wSkVaW_headerUtilities button, [class*="_headerUtilities"] button, .wSkVaW_headerActions button, [class*="_headerActions"] button')
        actionsBtn.hidden = true
        void nativeActions

        menuSep.hidden = menuItemNewWorkspace.hidden && menuItemCorner.hidden
        backdrop.hidden = !open
        menu.setAttribute('aria-expanded', String(open))
        const nextMenuLabel = open ? '关闭会话侧栏' : '打开会话侧栏'
        if (menu.getAttribute('aria-label') !== nextMenuLabel) menu.setAttribute('aria-label', nextMenuLabel)
        if (sidebar) {
          if (sidebar.id !== 'dsh-mobile-drawer') sidebar.id = 'dsh-mobile-drawer'
          const nextHidden = String(mobile && !open)
          if (sidebar.getAttribute('aria-hidden') !== nextHidden) sidebar.setAttribute('aria-hidden', nextHidden)
          if (sidebar.inert !== (mobile && !open)) sidebar.inert = mobile && !open
        }
        if (open && !previousOpen) win.requestAnimationFrame(() => doc.querySelector('[data-slot="sidebar"] button')?.focus())
        previousOpen = open

        if (mobile) {
          const toolsEl = doc.querySelector('[data-composer-card] .ccegLa_tools, [data-composer-card] .uV2eYG_tools, [data-composer-card] [class*="_tools"]')
          if (toolsEl) {
            if (!toolsEl.contains(uploadBtn)) toolsEl.prepend(uploadBtn)
            const addBtn = doc.querySelector('[data-composer-card] .ccegLa_add, [data-composer-card] .uV2eYG_add, [data-composer-card] [class*="_add"], [data-composer-card] button[aria-haspopup="listbox"]')
            if (addBtn && addBtn.style?.display !== 'none') {
              addBtn.style.setProperty('display', 'none')
            }
            const hasFv = typeof win.__dsh_open_file_viewer === 'function' || doc.querySelector('button[aria-label="查看项目文件"], button[title="查看项目文件"]') != null
            const hasTerm = typeof win.__dsh_open_terminal === 'function' || doc.querySelector('button[aria-label="打开本地终端"], button[title="打开本地终端"]') != null
            const hasPh = typeof win.__dsh_open_prompt_history === 'function' || doc.querySelector('button[aria-label="提示词历史"], button[title="提示词历史"]') != null
            if (hasFv || hasTerm || hasPh) {
              // 位置：盾牌右侧。但不能插进盾牌所在的 modes 容器 —— 那是
              // tools 栏的子容器，插进去后工具箱吃内层 gap、上传按钮吃外层
              // gap，跨容器边界会让两档间距在视觉上不齐。
              // 因此插在 toolsEl 这一层、紧跟 modes 之后：工具箱与上传按钮
              // 同级，所有间距统一由外层 gap:4px 决定，且位置仍在盾牌右侧。
              const shield = doc.querySelector('[data-composer-card] .Sh0Q9G_trigger, [data-composer-card] .iWlSmW_trigger, [data-composer-card] button[aria-label*="权限"], [data-composer-card] button[aria-label*="permission" i]')
              const modes = shield?.parentElement ?? null
              const anchor = modes != null && modes.parentElement === toolsEl ? modes : uploadBtn
              const misplaced = toolsBtn.parentElement !== toolsEl
                || toolsBtn.previousElementSibling !== anchor
              if (misplaced) {
                if (anchor.nextSibling) toolsEl.insertBefore(toolsBtn, anchor.nextSibling)
                else toolsEl.append(toolsBtn)
              }
            } else {
              toolsBtn.remove()
            }
          }
          const modelName = doc.querySelector('._7KE1Ra_triggerLabel')?.textContent?.trim()
          const effort = doc.querySelector('._7KE1Ra_triggerEffort')?.textContent?.trim()
          const cardEl = doc.querySelector('[data-composer-card]')
          if (cardEl && modelName) {
            const nextInfo = effort ? `${modelName} · ${effort}` : modelName
            if (infoEl.textContent !== nextInfo) infoEl.textContent = nextInfo
            if (cardEl.previousSibling !== infoEl) {
              // 幂等：infoEl 是单例。真实 DOM 会自动移动重复插入的节点，但宿主
              // 换会话 / 切视图可能把卡片挪进别的容器，届时旧节点会留在原地成为
              // 幽灵条。先摘再插，保证任何分支下都只有一个、且正好在卡片前面。
              if (typeof infoEl.remove === 'function') infoEl.remove()
              if (typeof cardEl.before === 'function') cardEl.before(infoEl)
              else if (cardEl.parentElement) cardEl.parentElement.prepend(infoEl)
            }
          } else {
            infoEl.remove()
          }
        } else {
          uploadBtn.remove()
          toolsBtn.remove()
          closeToolsMenu()
          infoEl.remove()
          const addBtn = doc.querySelector('[data-composer-card] .ccegLa_add, [data-composer-card] .uV2eYG_add, [data-composer-card] [class*="_add"], [data-composer-card] button[aria-haspopup="listbox"]')
          if (addBtn && typeof addBtn.style?.removeProperty === 'function') {
            addBtn.style.removeProperty('display')
          }
        }
        balanceComposerDock(doc, mobile)
      }

      const isRightbarOpen = () => {
        const panel = doc.querySelector('[data-sidebar-right-open]')
        if (!media.matches || !panel) return false
        if (typeof panel.closest === 'function') {
          return panel.closest('[hidden], [aria-hidden="true"]') === null
        }
        return true
      }
      const closeRightbar = () => {
        // 尝试点击原生收起按钮
        const toggleBtn = doc.querySelector('[data-sidebar-right-toggle], button[aria-label*="收起右侧栏"], button[aria-label*="Collapse right sidebar"]')
        if (toggleBtn) {
          toggleBtn.click()
          return
        }
        // 尝试通过 ctx.layout 关闭
        try {
          if (typeof ctx.layout?.closeRightbar === 'function') {
            ctx.layout.closeRightbar()
          }
        } catch (_) {}
      }

      // 移动端冷启动如果右侧栏在 localStorage 里是展开的，自动收起右侧栏回到会话
      let rightbarInitialChecked = false
      const checkInitialRightbar = () => {
        if (rightbarInitialChecked || !media.matches) return
        rightbarInitialChecked = true
        // 延迟一个 tick 检查，此时 React 树已完成首轮 commit
        setTimeout(() => {
          if (media.matches && isRightbarOpen()) {
            closeRightbar()
          }
        }, 100)
      }
      const toggle = () => {
        if (!media.matches) return
        ctx.layout.toggleSidebar()
      }
      const close = (restoreFocus = false) => {
        if (!isOpen()) return
        toggle()
        if (restoreFocus) win.requestAnimationFrame(() => menu.focus())
      }

      menu.addEventListener('click', toggle)
      backdrop.addEventListener('click', () => close(true))

      // —— 全屏切换 ——
      // 只收起浏览器自身的地址栏与底部工具栏（这两条属于浏览器 chrome，
      // CSS 动不了，只能靠 requestFullscreen()）。应用自己的顶栏、会话标题栏、
      // 对话/轨迹 tabs 全部保留——全屏后仍然需要它们来导航。
      // 状态只活在内存里：全屏是即时浏览偏好，不该跨刷新持久化。
      let fullscreen = false
      const isFullscreen = () => fullscreen
      const docEl = doc.documentElement
      // 记录是否为「我们自己发起的」浏览器全屏，避免用户按 Esc 退出时误把
      // 应用层状态也留在半屏错位状态。
      let browserFullscreenRequested = false

      const fullscreenElementOf = () =>
        doc.fullscreenElement || doc.webkitFullscreenElement || null

      const requestBrowserFullscreen = () => {
        const request = docEl.requestFullscreen || docEl.webkitRequestFullscreen
        if (typeof request !== 'function') return
        browserFullscreenRequested = true
        try {
          const result = request.call(docEl, { navigationUI: 'hide' })
          // 标准 API 返回 Promise；webOS/旧 WebView 可能返回 undefined。
          if (result && typeof result.catch === 'function') {
            result.catch(() => { browserFullscreenRequested = false })
          }
        } catch (_) {
          browserFullscreenRequested = false
        }
      }

      const exitBrowserFullscreen = () => {
        browserFullscreenRequested = false
        if (fullscreenElementOf() === null) return
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen
        if (typeof exit !== 'function') return
        try {
          const result = exit.call(doc)
          if (result && typeof result.catch === 'function') result.catch(() => {})
        } catch (_) {}
      }

      /**
       * 应用全屏状态。
       *
       * 应用层只改一个 `<html>` 上的标记属性（供 CSS 让布局跟随浏览器全屏后的
       * 视口高度重铺），**不动顶栏**——顶栏与退出按钮都留在原位，全屏前后
       * 位置完全一致，用户不会看到按钮跳变。
       *
       * @param {boolean} next 目标状态
       * @param {{ skipBrowser?: boolean }} [options] skipBrowser 为 true 时不动浏览器层，
       *   用于响应浏览器自己发起的 fullscreenchange（例如用户按 Esc 退出）。
       */
      const applyFullscreen = (next, options = {}) => {
        const target = Boolean(next) && media.matches
        fullscreen = target
        // 属性挂在 <html> 上：CSS 里所有全屏规则都以 html[data-dsh-mobile-fullscreen]
        // 为作用域，挂到 #root 会让这些规则一条都不命中。
        if (target) docEl.setAttribute('data-dsh-mobile-fullscreen', 'true')
        else docEl.removeAttribute('data-dsh-mobile-fullscreen')
        if (!options.skipBrowser) {
          if (target) requestBrowserFullscreen()
          else exitBrowserFullscreen()
        }
        const nextLabel = target ? '退出全屏' : '进入全屏'
        if (fullscreenToggle.getAttribute('aria-label') !== nextLabel) {
          fullscreenToggle.setAttribute('aria-label', nextLabel)
          fullscreenToggle.title = nextLabel
        }
        fullscreenToggle.setAttribute('aria-pressed', String(target))
        // 相关布局变量变化后让宿主的 sticky/滚动容器重新测量。
        // 不派发 win.Event：测试替身与部分 WebView 没有该构造器，
        // 直接调用已有的 syncViewport 更可靠，也不依赖事件系统。
        win.requestAnimationFrame(() => syncViewport())
      }

      // 浏览器层退出（用户按 Esc、系统手势、切后台等）时同步应用层标记，
      // 让按钮的 aria 状态与实际全屏状态一致。
      // 只处理我们自己发起过的情况，避免宿主/其它插件进入全屏时被我们误退。
      const onFullscreenChange = () => {
        if (fullscreenElementOf() !== null) return
        if (!browserFullscreenRequested) return
        browserFullscreenRequested = false
        if (fullscreen) applyFullscreen(false, { skipBrowser: true })
        sync()
      }
      doc.addEventListener('fullscreenchange', onFullscreenChange)
      doc.addEventListener('webkitfullscreenchange', onFullscreenChange)

      fullscreenToggle.addEventListener('click', () => {
        // 进入全屏前先收起侧边抽屉，否则它会盖住刚铺满的内容区
        if (!fullscreen && isOpen()) close(false)
        applyFullscreen(!fullscreen)
        sync()
      })

      view.addEventListener('click', () => {
        if (isRightbarOpen()) {
          closeRightbar()
          sync()
          return
        }
        const trajectory = trajectoryOf()
        const target = trajectory?.getAttribute('aria-selected') === 'true' ? chatOf() : trajectory
        target?.click()
        sync()
      })

      // 记录"按下时是否在工具箱之外"，配合 pointerup 判定真正的外部点击
      let toolsPressedOutside = false
      // 判断点击是否落在工具箱（按钮或菜单）内部；closest 兼容任意 target（SVG、emoji 等）
      const insideTools = (target) => {
        if (!target) return false
        if (typeof target.closest === 'function') {
          return target.closest('.dsh-mobile-tools-menu, .dsh-mobile-tools-btn') !== null
        }
        return toolsMenu.contains(target) || toolsBtn.contains(target)
      }
      /**
       * Whether a click inside the drawer should dismiss it.
       *
       * Only a session row does: it opens that session, so the drawer has done
       * its job. A workspace (project) row is a *disclosure* control — the host
       * toggles its subtree on click — and closing the drawer there hid the
       * very list the user just asked to see, which read as "tapping a folder
       * does nothing".
       *
       * The host marks project rows with `aria-expanded` (session rows have
       * none), which is the only stable way to tell the two `role="treeitem"`
       * siblings apart. Rows also carry their own buttons (⋯ menu, ＋ new
       * session) that already stop propagation, so this only sees row taps.
       *
       * @param {Element | null | undefined} target - the click target.
       * @returns {boolean} true when the drawer should close.
       */
      const dismissesDrawer = (target) => {
        const row = target?.closest?.('[data-slot="sidebar"] [role="treeitem"]')
        if (!row) return false
        // Test doubles and pre-0.2 hosts have no attribute API; treat them as
        // session rows so the original dismiss behaviour is preserved.
        if (typeof row.hasAttribute !== 'function') return true
        return !row.hasAttribute('aria-expanded')
      }
      const onClick = (event) => {
        if (!toolsMenu.hidden && !insideTools(event.target)) {
          closeToolsMenu()
        }
        if (media.matches && dismissesDrawer(event.target)) close()
      }
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return
        if (!toolsMenu.hidden) {
          closeToolsMenu()
          return
        }
        if (isRightbarOpen()) {
          closeRightbar()
          sync()
          return
        }
        if (trajectoryOf()?.getAttribute('aria-selected') === 'true') {
          chatOf()?.click()
          sync()
          win.requestAnimationFrame(() => view.focus())
        } else close(true)
      }
      let gesture
      const onPointerDown = (event) => {
        // 只记录按下位置是否在工具箱外，绝不在此关闭菜单：
        // 按下即关会让菜单在手指抬起前消失，click 落到下层元素（输入框）。
        toolsPressedOutside = !toolsMenu.hidden && !insideTools(event.target)
        if (!media.matches || event.isPrimary === false) return
        const open = isOpen()
        if (!open && event.clientX > 24) return
        if (open && !event.target?.closest?.('[data-slot="sidebar"]')) return
        gesture = { x: event.clientX, y: event.clientY, open }
      }
      const onPointerUp = (event) => {
        // 按下与抬起都落在工具箱之外，才算真正的"点击外部"，此时关闭菜单。
        if (toolsPressedOutside && !toolsMenu.hidden && !insideTools(event.target)) {
          closeToolsMenu()
        }
        toolsPressedOutside = false
        if (!gesture) return
        const dx = event.clientX - gesture.x
        const dy = Math.abs(event.clientY - gesture.y)
        const wasOpen = gesture.open
        gesture = undefined
        if (dy > 48 || Math.abs(dx) < 56) return
        if ((!wasOpen && dx > 0) || (wasOpen && dx < 0)) toggle()
      }

      doc.addEventListener('click', onClick)
      doc.addEventListener('keydown', onKeyDown)
      doc.addEventListener('pointerdown', onPointerDown, { passive: true })
      doc.addEventListener('pointerup', onPointerUp, { passive: true })

      const root = doc.getElementById('root')
      // 帧合并与防自激：
      // 1. 处于桌面端视口且已完成桌面态重置时，彻底忽略后续 DOM 突变，杜绝桌面端无效轮转与高 CPU/内存；
      // 2. isSyncing 防重入锁确保 sync() 内部改动 DOM 产生的微任务突变全部被 takeRecords 清理，避免陷入无限 RAF 递归风暴。
      let syncQueued = false
      let viewportQueued = false
      let isSyncing = false
      let desktopSettled = false
      const requestSync = () => {
        if (isSyncing || syncQueued) return
        if (!media.matches && desktopSettled) return
        syncQueued = true
        win.requestAnimationFrame(() => {
          syncQueued = false
          if (isSyncing) return
          try {
            isSyncing = true
            sync()
            desktopSettled = !media.matches
          } finally {
            if (typeof observer?.takeRecords === 'function') {
              observer.takeRecords()
            }
            isSyncing = false
          }
        })
      }
      const requestViewport = () => {
        if (viewportQueued) return
        if (!media.matches && desktopSettled) return
        viewportQueued = true
        win.requestAnimationFrame(() => { viewportQueued = false; syncViewport() })
      }
      const observer = new MutationObserver(requestSync)
      if (root) observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-sidebar-collapsed', 'data-phase', 'aria-label', 'aria-selected', 'placeholder', 'disabled', 'data-sidebar-right-open'],
      })
      const onMedia = () => {
        desktopSettled = false
        requestSync()
        requestViewport()
      }
      const modernMedia = typeof media.addEventListener === 'function'
      if (modernMedia) media.addEventListener('change', onMedia)
      else media.addListener?.(onMedia)

      const viewport = win.visualViewport
      const syncViewport = () => {
        const rootStyle = doc.documentElement.style
        if (!media.matches) {
          if (rootStyle.getPropertyValue('--dsh-vvh')) rootStyle.removeProperty('--dsh-vvh')
          if (rootStyle.getPropertyValue('--dsh-keyboard-inset')) rootStyle.removeProperty('--dsh-keyboard-inset')
          return
        }
        const viewportHeight = viewport?.height ?? win.innerHeight
        const nextVvh = viewportHeight ? `${Math.round(viewportHeight)}px` : ''
        if (nextVvh && rootStyle.getPropertyValue('--dsh-vvh') !== nextVvh) rootStyle.setProperty('--dsh-vvh', nextVvh)
        const active = doc.activeElement
        // 宿主 0.2.0-rc.2 起输入区是 contenteditable（[data-composer-input]）而非
        // textarea，只认 tagName === 'TEXTAREA' 会让下面的键盘内边距兜底恒为 0。
        const editing = active != null
          && (active.isContentEditable === true || active.tagName === 'TEXTAREA')
          && (typeof active.closest !== 'function' || active.closest('[data-composer-card]') !== null)
        const layoutHeight = win.innerHeight || doc.documentElement.clientHeight || viewportHeight || 0
        const visibleBottom = viewport == null ? layoutHeight : viewport.height + (viewport.offsetTop || 0)
        const inset = editing && (viewport?.scale ?? 1) === 1
          ? Math.max(0, Math.round(layoutHeight - visibleBottom))
          : 0
        const nextInset = `${inset}px`
        if (rootStyle.getPropertyValue('--dsh-keyboard-inset') !== nextInset) rootStyle.setProperty('--dsh-keyboard-inset', nextInset)
      }
      viewport?.addEventListener('resize', requestViewport)
      viewport?.addEventListener('scroll', requestViewport)
      doc.addEventListener('focusin', requestViewport)
      doc.addEventListener('focusout', requestViewport)
      syncViewport()
      requestSync()
      checkInitialRightbar()

      return () => {
        observer.disconnect()
        if (modernMedia) media.removeEventListener('change', onMedia)
        else media.removeListener?.(onMedia)
        viewport?.removeEventListener('resize', syncViewport)
        viewport?.removeEventListener('scroll', syncViewport)
        doc.removeEventListener('focusin', syncViewport)
        doc.removeEventListener('focusout', syncViewport)
        doc.removeEventListener('click', onClick)
        doc.removeEventListener('keydown', onKeyDown)
        doc.removeEventListener('pointerdown', onPointerDown)
        doc.removeEventListener('pointerup', onPointerUp)
        doc.removeEventListener('fullscreenchange', onFullscreenChange)
        doc.removeEventListener('webkitfullscreenchange', onFullscreenChange)
        // 卸载时若还停在浏览器全屏，必须退出：否则宿主页面被卸载后
        // 浏览器仍留在全屏态，用户会卡在没有地址栏的空白页里。
        exitBrowserFullscreen()
        docEl.removeAttribute('data-dsh-mobile-fullscreen')
        doc.documentElement.style.removeProperty('--dsh-vvh')
        doc.documentElement.style.removeProperty('--dsh-keyboard-inset')
        style.remove()
        bar.remove()
        backdrop.remove()
        fileInput.remove()
        uploadBtn.remove()
        toolsBtn.remove()
        toolsBackdrop.remove()
        toolsMenu.remove()
        actionsBtn.remove()
        cornerBtn.remove()
        fullscreenToggle.remove()
        infoEl.remove()
        const addBtn = doc.querySelector('[data-composer-card] .ccegLa_add, [data-composer-card] .uV2eYG_add, [data-composer-card] [class*="_add"], [data-composer-card] button[aria-haspopup="listbox"]')
        if (addBtn && typeof addBtn.style?.removeProperty === 'function') {
          addBtn.style.removeProperty('display')
        }
        // 卸载时撤掉 dock 配平，避免把卡片内边距/负边距留在宿主页面上
        balanceComposerDock(doc, false)
      }
    }

    function apply(ctx) {
      ctx.effect(() => mount(ctx), 'mobile-adapter: responsive shell')
    }

    exports.apply = apply
    exports.inject = inject
    exports.internals = { MOBILE_QUERY, css, mount, statusOf, titleOf, balanceComposerDock }
    return module.exports
  },
})
