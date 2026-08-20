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
  id: 'dsh-mobile-adapter',
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
        .dsh-mobile-bar{box-sizing:border-box;position:fixed;z-index:900;top:0;right:0;left:0;height:calc(52px + var(--dsh-sat));padding:var(--dsh-sat) max(8px,var(--dsh-sar)) 0 max(8px,var(--dsh-sal));border-bottom:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-base) 92%,transparent);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);align-items:center;gap:8px;color:var(--dsw-alias-label-primary);display:flex}
        .dsh-mobile-icon{box-sizing:border-box;width:44px;height:44px;flex:none;border:0;border-radius:12px;background:transparent;color:inherit;font:600 23px/1 var(--dsw-font-family);display:grid;place-items:center;cursor:pointer}
        .dsh-mobile-icon:hover,.dsh-mobile-icon:active,.dsh-mobile-view:hover,.dsh-mobile-view:active{background:var(--dsw-alias-interactive-bg-hover)}
        .dsh-mobile-view{box-sizing:border-box;min-width:72px;height:44px;flex:none;border:0;border-radius:12px;background:transparent;color:inherit;font:600 13px/1 var(--dsw-font-family);display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 10px;cursor:pointer;white-space:nowrap}
        .dsh-mobile-view[hidden]{display:none}
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
        [data-slot="sidebar"] :where(.hHd-Xa_newSession,.hHd-Xa_navList,.hHd-Xa_regionArea,.hHd-Xa_footerActions,.hHd-Xa_settingsArea,.qDHVXG_root,.qDHVXG_listArea,.qDHVXG_list,[role="tree"],[role="treeitem"],[data-slot="sidebar.settings"],.VOzbGW_trigger){box-sizing:border-box;width:100%!important;max-width:100%!important;margin:0!important}
        [data-slot="sidebar"] :where(.hHd-Xa_regionArea,.qDHVXG_root,.qDHVXG_listArea,.qDHVXG_list){padding-left:0!important;padding-right:0!important}
        [data-slot="sidebar"] .qDHVXG_list{scrollbar-gutter:auto!important}
        [data-slot="root"]>div>div:has(>[data-slot="conversation"]){box-sizing:border-box;display:flex;width:100vw;height:100%;min-height:0;padding:calc(52px + var(--dsh-sat)) var(--dsh-sar) var(--dsh-keyboard-inset,0px) var(--dsh-sal);overflow:hidden}
        [data-slot="conversation"]{flex:1 1 0;height:100%;min-width:0;min-height:0}
        [data-slot="conversation.session.header"]>header{display:none!important}
        .wSkVaW_heroWorkspaceRow{box-sizing:border-box;width:100%;padding:0 20px!important;gap:4px!important;flex-wrap:wrap}
        .pXSMma_workspace{box-sizing:border-box;min-width:0!important;max-width:100%!important;min-height:36px!important;flex:1 1 140px}
        [data-slot="conversation.hero.agentPreset"]>span{min-width:0;max-width:min(50%,240px);flex:0 1 auto}
        [data-slot="conversation.hero.agentPreset"] .cubgiG_seat{box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:36px;min-height:36px;padding:0 10px;border-radius:999px}
        [data-conversation-scroll]{flex:1 1 0;min-width:0;min-height:0;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
        [data-conversation-scroll] :has(>[data-chat-flow]){padding-right:12px!important;padding-left:12px!important}
        [data-chat-flow]{width:100%;max-width:100%;gap:12px!important}
        [data-chat-anchor-key],[data-chat-flow]>*{min-width:0;max-width:100%}
        [data-chat-flow] [class*="_userStack"]{max-width:min(88%,calc(100vw - 48px))}
        [data-chat-flow] [class*="_gallery"],[data-chat-flow] [class*="_frame"]{max-width:100%!important}
        [data-chat-flow] :where(img,video,canvas,svg){max-width:100%;height:auto}
        [data-chat-flow] [class*="_actions"]{box-sizing:border-box;display:flex;flex-wrap:wrap!important;width:100%!important;max-width:100%!important;min-width:0!important;height:auto!important;min-height:32px;align-items:center;gap:6px!important;padding-right:max(4px,var(--dsh-sar));overflow:visible!important}
        .p-xYUq_actions,._8_XoUG_action,.osXY9a_actions{flex-wrap:wrap!important}
        .p-xYUq_actions,.osXY9a_actions{height:auto!important;max-width:100%;min-width:0;overflow:visible!important}
        [data-chat-flow] [class*="_actions"] button{box-sizing:border-box;flex:0 0 32px;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;border-radius:50%!important;padding:5px}
        [data-chat-flow] [class*="_actions"] :where([class*="_timeStart"],[class*="_timeEnd"]){display:none!important}
        .FJxK0a_root{display:none!important}
        [data-composer-seat]{flex:none;bottom:0;padding-bottom:max(8px,var(--dsh-sab))}
        [data-composer-card]{box-sizing:border-box;max-width:none!important;border-radius:18px!important;padding:8px 10px 6px!important}
        [data-composer-card]>:last-child{box-sizing:border-box;display:flex;width:100%;min-height:44px;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between;gap:4px!important;padding:4px 8px 8px!important;overflow:visible!important}
        .uV2eYG_tools,.uV2eYG_trailing{box-sizing:border-box;display:flex;align-items:center;min-width:0}
        .uV2eYG_tools{min-width:max-content;flex:1 1 auto;gap:4px!important;overflow:visible!important}
        .uV2eYG_tools::-webkit-scrollbar{display:none}
        .uV2eYG_modes{flex:none;flex-wrap:nowrap!important;align-items:center;gap:4px!important;overflow:visible!important}
        .uV2eYG_trailing{flex:none;max-width:calc(100% - 36px);margin-left:auto;justify-content:flex-end;gap:6px!important;overflow:visible}
        .uV2eYG_add{display:none!important}
        /* Unified Mobile Action Button Spec (32x32 round circle, subtle background, clean border, centered icon) */
        .dsh-mobile-upload-btn,
        .dsh-mobile-tools-btn,
        .Sh0Q9G_trigger,
        .term-composer-btn,
        ._7KE1Ra_trigger,
        .JObwrW_trigger {
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
        .Sh0Q9G_trigger:hover,.Sh0Q9G_trigger:active,
        .term-composer-btn:hover,.term-composer-btn:active,
        ._7KE1Ra_trigger:hover,._7KE1Ra_trigger:active,
        .JObwrW_trigger:hover,.JObwrW_trigger:active {
          background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.12))!important;
          color:var(--dsw-alias-label-primary)!important;
          transform:scale(.96)!important;
        }
        .dsh-mobile-upload-btn svg{width:16px;height:16px;flex:none;display:block}
        .uV2eYG_primary{box-sizing:border-box;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;flex:none;border-radius:50%!important;display:grid;place-items:center;background:var(--dsw-alias-brand-primary,#4d6bfe)!important;color:#fff!important;border:none!important}
        .uV2eYG_primary{transform:none!important}
        .uV2eYG_primary:active{transform:scale(.96)!important}
        .Sh0Q9G_trigger,.uV2eYG_select,.rS3zOq_chip,._7KE1Ra_trigger{box-sizing:border-box;height:32px!important;min-height:32px!important;font-size:12px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
        .rS3zOq_chip{box-sizing:border-box!important;width:max-content!important;height:32px!important;min-width:max-content!important;min-height:32px!important;padding:0 10px!important;border-radius:999px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:4px!important;white-space:nowrap!important;overflow:visible!important;flex:none!important;line-height:1!important}
        [data-plan-review-key],[data-slot="conversation.composer.dock"],[data-plan-review-scroll]{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;min-height:0!important;display:flex!important;flex-direction:column!important;overflow:visible!important}
        [data-plan-review-scroll]{max-height:min(45dvh,360px)!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important}
        .Sh0Q9G_trigger,.uV2eYG_select{max-width:32px!important;min-width:32px!important}
        .Sh0Q9G_triggerIcon{display:inline-grid!important;place-items:center!important;flex:none;margin:0!important}
        .uV2eYG_modes .Sh0Q9G_triggerLabel{display:none!important}
        .Sh0Q9G_triggerLabel{display:none!important}
        .Sh0Q9G_chevron{display:none!important}
        ._7KE1Ra_root{flex:none!important;width:32px!important;max-width:32px!important;min-width:32px!important}
        ._7KE1Ra_triggerLabel,._7KE1Ra_triggerEffort,._7KE1Ra_chevron{display:none!important}
        ._7KE1Ra_trigger::before{content:"";width:16px;height:16px;display:block;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.5L14 4.5V11.5L8 14.5L2 11.5V4.5L8 1.5Z' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M8 1.5V14.5M2 4.5L14 11.5M2 11.5L14 4.5' stroke='black' stroke-width='1.1'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.5L14 4.5V11.5L8 14.5L2 11.5V4.5L8 1.5Z' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M8 1.5V14.5M2 4.5L14 11.5M2 11.5L14 4.5' stroke='black' stroke-width='1.1'/%3E%3C/svg%3E") center/contain no-repeat}
        .dsh-mobile-composer-info{box-sizing:border-box;width:100%;padding:4px 12px 2px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.2px}
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
        .JObwrW_root{width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;flex:none!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}
        [data-composer-card] textarea{box-sizing:border-box;min-height:44px;max-height:160px;font-size:16px!important}
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
        .Y0dWHa_details{box-sizing:border-box;position:fixed!important;z-index:950!important;inset:calc(52px + var(--dsh-sat)) 0 var(--dsh-keyboard-inset,0px)!important;width:100vw!important;max-width:none!important;min-width:0!important;border-left:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-layer-1);animation:dsh-mobile-detail-in .24s var(--ds-ease-in-out)}
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
        [role="menu"],._7KE1Ra_menu,._3e4SsG_menu{box-sizing:border-box!important;z-index:1300!important;max-width:calc(100vw - 24px)!important;max-height:min(360px,calc(var(--dsh-vvh,100dvh) - 120px))!important;border-radius:14px!important;box-shadow:var(--dsw-shadow-lv3)!important;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3))!important;border:1px solid var(--dsw-alias-border-l2)!important;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important}
        span>[role="menu"]{position:absolute!important;bottom:calc(100% + 4px)!important;left:0!important;min-width:140px!important}
        body>[role="menu"]{min-width:180px!important}
        body>[role="menu"]:has(.cubgiG_item){width:min(300px,calc(100vw - 24px))!important}
        body>[role="menu"]:has(.cubgiG_item) [role="menuitem"]{box-sizing:border-box;min-height:56px;padding:8px 12px}
        body>[role="menu"] .cubgiG_item{max-width:none;min-width:0}
        body>[role="menu"] .cubgiG_itemDesc{overflow-wrap:anywhere}
        ._3e4SsG_menu{position:absolute!important;bottom:calc(100% + 4px)!important;left:0!important;right:auto!important;width:min(320px,calc(100vw - 24px))!important}
        ._3e4SsG_item{box-sizing:border-box;min-height:44px!important;padding:8px 12px!important}
        ._3e4SsG_itemName{max-width:50%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
        ._7KE1Ra_menu{position:absolute!important;bottom:calc(100% + 8px)!important;right:-80px!important;left:auto!important;width:min(280px,calc(100vw - 32px))!important;max-width:calc(100vw - 32px)!important}
        ._7KE1Ra_option,._7KE1Ra_cell{box-sizing:border-box!important;width:100%!important;min-width:0!important}
        ._7KE1Ra_modelName,._7KE1Ra_description,._7KE1Ra_cellLabel,._7KE1Ra_cellValue{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
        ._7KE1Ra_cell{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:6px!important;max-width:100%!important;overflow:hidden!important}
        ._7KE1Ra_cellLabel{flex:none!important;max-width:40%!important;color:var(--dsw-alias-label-primary)!important;white-space:nowrap!important}
        ._7KE1Ra_cellValue{flex:1 1 auto!important;min-width:0!important;text-align:right!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
        ._7KE1Ra_cellChevron{flex:none!important}
        .VOzbGW_overlay{box-sizing:border-box;z-index:1100!important;position:fixed!important;inset:0!important;width:100vw;height:var(--dsh-vvh,100dvh)!important;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch}
        .VOzbGW_mask{display:none!important}
        .VOzbGW_panel{box-sizing:border-box;position:relative!important;inset:auto!important;width:100vw!important;height:100%!important;max-width:none!important;max-height:none!important;padding:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-base)!important;display:flex;flex-direction:column;overflow:hidden}
        /* The shell's overlay layer is its own stacking context at z-index 20,
           which traps anything inside it below .dsh-mobile-bar (z-index 900) —
           the bar covered the drawer's header and swallowed its close button.
           Raise the layer itself; the scrim's own z-index cannot escape it. */
        [data-slot="root"] .pI_x6G_overlayLayer:has(.fv-scrim){z-index:1100!important}
        /* dsh-file-viewer drawer. A 64vw panel is unusable on a phone, so it
           takes the whole screen. Height tracks the visual viewport instead of
           100dvh, which some mobile browsers report before the address bar
           settles, and both edges respect the safe-area insets. */
        .fv-scrim{box-sizing:border-box;z-index:1100!important;position:fixed!important;inset:0!important;width:100vw!important;height:var(--dsh-vvh,100dvh)!important;padding:0!important;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))!important;animation:none!important}
        .fv-shell{box-sizing:border-box;width:100vw!important;height:100%!important;max-width:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff))!important;animation:none!important}
        .fv-head{box-sizing:border-box;flex:none;gap:6px!important;padding:calc(6px + var(--dsh-sat)) max(8px,var(--dsh-sar)) 6px max(8px,var(--dsh-sal))!important}
        .fv-title{display:none!important}
        .fv-root-select{flex:none;max-width:38vw!important}
        .fv-icon-button{width:40px!important;height:40px!important;flex:none}
        .fv-tree,.fv-content{padding-bottom:max(12px,var(--dsh-sab))!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important}
        .fv-row{min-height:40px!important}
        .fv-pager{padding-bottom:max(8px,var(--dsh-sab))!important}
        .fv-pager .fv-button,.fv-note .fv-button{min-height:40px!important}
        .fv-table th,.fv-table td{max-width:60vw!important}
        .fv-float-entry{display:none!important}
        .VOzbGW_nav{box-sizing:border-box;width:100%!important;flex:none;gap:0!important;padding:calc(44px + var(--dsh-sat)) 0 0!important;display:flex;flex-direction:column}
        .VOzbGW_navTitle{box-sizing:border-box;position:absolute;z-index:3;top:var(--dsh-sat);right:72px;left:72px;width:auto;height:44px;padding:0;color:var(--dsw-alias-label-primary);font-weight:600;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
        .VOzbGW_navList{box-sizing:border-box;width:auto!important;max-width:calc(100vw - 32px)!important;height:44px;min-height:44px;margin:4px max(16px,var(--dsh-sar)) 12px max(16px,var(--dsh-sal))!important;padding:4px!important;border-radius:14px!important;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.04))!important;display:inline-flex!important;flex-direction:row!important;gap:4px!important;overflow-x:auto!important;overflow-y:hidden;overscroll-behavior-x:contain;scroll-behavior:smooth;scrollbar-width:none!important;-webkit-overflow-scrolling:touch!important}
        .VOzbGW_navList::-webkit-scrollbar{display:none!important}
        .VOzbGW_navCell{box-sizing:border-box;flex:none;height:36px!important;min-width:44px;min-height:36px!important;padding:0 14px!important;border:0!important;border-radius:10px!important;background:transparent!important;color:var(--dsw-alias-label-tertiary)!important;font-size:13px!important;font-weight:500!important;line-height:18px;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;white-space:nowrap!important;transition:all .2s cubic-bezier(.4,0,.2,1)!important}
        .VOzbGW_navCell:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-secondary)!important}
        .VOzbGW_navCell:active{transform:scale(.98)}
        .VOzbGW_navCell:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
        .VOzbGW_navCell.VOzbGW_active{background:var(--dsw-alias-bg-layer-1,#fff)!important;color:var(--dsw-alias-label-primary)!important;font-weight:600!important;box-shadow:0 2px 8px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04)!important}
        .VOzbGW_navIcon{width:16px;height:16px;flex:none}
        .VOzbGW_navLabel{min-width:0;flex:none;white-space:nowrap;overflow:visible}
        .VOzbGW_content{width:100%;flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column}
        .VOzbGW_header{box-sizing:border-box;position:absolute;z-index:2;top:0;right:0;left:0;height:calc(44px + var(--dsh-sat))!important;min-height:calc(44px + var(--dsh-sat));padding:var(--dsh-sat) max(4px,var(--dsh-sar)) 0 max(4px,var(--dsh-sal))!important;border-bottom:0;background:var(--dsw-alias-bg-base);align-items:center!important;justify-content:space-between!important}
        .VOzbGW_actions{max-width:calc(50vw - 52px);margin-left:0!important;overflow:hidden}
        .VOzbGW_close{width:44px!important;height:44px!important;min-width:44px;min-height:44px;border-radius:12px!important;background:transparent;flex:none}
        .VOzbGW_close:hover,.VOzbGW_close:active{background:var(--dsw-alias-interactive-bg-hover)}
        .VOzbGW_options{box-sizing:border-box;width:100%;flex:1 1 0;min-width:0;min-height:0;padding:4px max(16px,var(--dsh-sar)) max(24px,var(--dsh-sab)) max(16px,var(--dsh-sal))!important;background:var(--dsw-alias-bg-base);overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
        .VOzbGW_options :where(*,section,form,fieldset){min-width:0}
        .VOzbGW_options>[data-slot="settings.section"]>:has(>[data-slot="settings.general.item"]){box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
        .VOzbGW_options [data-slot="settings.general.item"]>*{box-sizing:border-box;min-height:72px;padding:14px 16px!important}
        .VOzbGW_options .oY77xG_row{flex-wrap:wrap}
        .VOzbGW_options .oY77xG_rowText{flex:1 1 120px;padding-right:8px!important}
        .VOzbGW_options :where(input:not([type="checkbox"]):not([type="radio"]),select,textarea){box-sizing:border-box;min-width:0!important;max-width:100%!important;min-height:44px!important;border-radius:12px!important;font-size:16px!important}
        .VOzbGW_options :where(button,[role="button"],[role="switch"],summary){min-width:44px;min-height:44px;touch-action:manipulation}
        .VOzbGW_options input[type="range"]{height:44px!important}
        .VOzbGW_options label:has(input:is([type="checkbox"],[type="radio"])){min-height:44px}
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

    function titleOf(doc) {
      const current = doc.querySelector('[data-slot="conversation.session.header"] nav button:disabled')
      return current?.textContent?.trim() || '新会话'
    }

    function statusOf(doc) {
      const running = doc.querySelector('[data-composer-card] button[aria-label^="停止"], [data-composer-card] button[aria-label^="Stop"]') != null
      const base = running ? '运行中' : doc.querySelector('[data-slot="conversation"]>[data-phase="hero"]') ? '新会话' : '就绪'
      const preset = (doc.querySelector('[data-slot="conversation.session.header"] .SVAs4q_label')
        || doc.querySelector('[data-slot="conversation.hero.agentPreset"]'))?.textContent?.trim().replace(/\s+/g, ' ')
      const permissionTrigger = doc.querySelector('.Sh0Q9G_trigger, [data-composer-card] button[aria-label*="权限"], [data-composer-card] button[aria-label*="permission" i]')
      const permission = doc.querySelector('.Sh0Q9G_triggerLabel')?.textContent?.trim()
        || permissionTrigger?.textContent?.trim()
        || permissionTrigger?.getAttribute('aria-label')?.replace(/^(?:权限|permission)\s*[:：]?\s*/i, '').trim()
      const placeholder = doc.querySelector('[data-composer-card] textarea')?.getAttribute('placeholder') || ''
      const plan = doc.querySelector('.rS3zOq_chip') != null || /(计划|plan)/i.test(placeholder)
      return {
        text: [base, preset, base === '新会话' ? '' : permission].filter(Boolean).join(' · ') + (plan ? ' [计划]' : ''),
        running,
        plan,
        preset,
      }
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
      bar.append(menu, titleBox, view)

      const backdrop = doc.createElement('button')
      backdrop.type = 'button'
      backdrop.className = 'dsh-mobile-backdrop'
      backdrop.setAttribute('aria-label', '关闭会话侧栏')
      backdrop.hidden = true

      const fileInput = doc.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/*'
      fileInput.multiple = true
      fileInput.style.display = 'none'
      fileInput.setAttribute('aria-hidden', 'true')

      const uploadBtn = doc.createElement('button')
      uploadBtn.type = 'button'
      uploadBtn.className = 'dsh-mobile-upload-btn'
      uploadBtn.setAttribute('aria-label', '上传图片')
      uploadBtn.title = '上传图片'
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
        fileInput.click()
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

      const toggleToolsMenu = (e) => {
        e?.stopPropagation()
        const hasFv = typeof win.__dsh_open_file_viewer === 'function' || doc.querySelector('button[aria-label="查看项目文件"], button[title="查看项目文件"]') != null
        const hasTerm = typeof win.__dsh_open_terminal === 'function' || doc.querySelector('button[aria-label="打开本地终端"], button[title="打开本地终端"]') != null

        if (hasFv && !hasTerm) {
          openFileViewer()
          return
        }
        if (hasTerm && !hasFv) {
          openTerminal()
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
      doc.body.append(bar, backdrop, fileInput, toolsBackdrop, toolsMenu)

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
        view.hidden = !mobile || trajectory == null
        if (view.textContent !== (inTrajectory ? '← 对话' : '⌁ 轨迹')) view.textContent = inTrajectory ? '← 对话' : '⌁ 轨迹'
        const nextViewLabel = inTrajectory ? '关闭轨迹，返回对话' : '查看轨迹'
        if (view.getAttribute('aria-label') !== nextViewLabel) view.setAttribute('aria-label', nextViewLabel)
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
          const toolsEl = doc.querySelector('[data-composer-card] .uV2eYG_tools')
          if (toolsEl) {
            if (!toolsEl.contains(uploadBtn)) toolsEl.prepend(uploadBtn)
            const hasFv = typeof win.__dsh_open_file_viewer === 'function' || doc.querySelector('button[aria-label="查看项目文件"], button[title="查看项目文件"]') != null
            const hasTerm = typeof win.__dsh_open_terminal === 'function' || doc.querySelector('button[aria-label="打开本地终端"], button[title="打开本地终端"]') != null
            if (hasFv || hasTerm) {
              // 位置：盾牌右侧。但不能插进盾牌所在的 .uV2eYG_modes —— 那是
              // .uV2eYG_tools 的子容器，插进去后工具箱吃内层 gap、上传按钮吃外层
              // gap，跨容器边界会让两档间距在视觉上不齐。
              // 因此插在 .uV2eYG_tools 这一层、紧跟 modes 之后：工具箱与上传按钮
              // 同级，所有间距统一由外层 gap:4px 决定，且位置仍在盾牌右侧。
              const shield = doc.querySelector('[data-composer-card] .Sh0Q9G_trigger')
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
            if (cardEl.nextSibling !== infoEl) {
              if (typeof cardEl.after === 'function') cardEl.after(infoEl)
              else if (cardEl.parentElement) cardEl.parentElement.append(infoEl)
            }
          } else {
            infoEl.remove()
          }
        } else {
          uploadBtn.remove()
          toolsBtn.remove()
          closeToolsMenu()
          infoEl.remove()
        }
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
      view.addEventListener('click', () => {
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
      const onClick = (event) => {
        if (!toolsMenu.hidden && !insideTools(event.target)) {
          closeToolsMenu()
        }
        if (media.matches && event.target?.closest?.('[data-slot="sidebar"] [role="treeitem"]')) close()
      }
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return
        if (!toolsMenu.hidden) {
          closeToolsMenu()
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
      // 帧合并：mutation 风暴期间每帧最多跑一次 sync/syncViewport，
      // 避免 React 渲染产生的密集 DOM 变化把主线程占满（移动端卡死）。
      let syncQueued = false
      let viewportQueued = false
      const requestSync = () => {
        if (syncQueued) return
        syncQueued = true
        win.requestAnimationFrame(() => { syncQueued = false; sync() })
      }
      const requestViewport = () => {
        if (viewportQueued) return
        viewportQueued = true
        win.requestAnimationFrame(() => { viewportQueued = false; syncViewport() })
      }
      const observer = new MutationObserver(requestSync)
      if (root) observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-sidebar-collapsed', 'data-phase', 'aria-label', 'aria-selected', 'placeholder', 'disabled'],
      })
      const onMedia = () => {
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
        const editing = active?.tagName === 'TEXTAREA'
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
        infoEl.remove()
      }
    }

    function apply(ctx) {
      ctx.effect(() => mount(ctx), 'mobile-adapter: responsive shell')
    }

    exports.apply = apply
    exports.inject = inject
    exports.internals = { MOBILE_QUERY, css, mount, statusOf, titleOf }
    return module.exports
  },
})
