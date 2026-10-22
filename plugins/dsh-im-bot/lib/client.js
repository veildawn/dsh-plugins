/**
 * dsh-im-bot 前端设置面板。
 *
 * 在 DSH 的「设置 → 集成机器人」里提供：
 *   - 总开关与两个通道的启用开关；
 *   - 企业微信：BotID / Secret / 长连接地址 + 实时状态；
 *   - 个人微信：扫码登录（二维码 + 轮询）、账号状态；
 *   - 白名单（单聊/群聊）、通知开关与长度上限；
 *   - 绑定列表（哪个聊天绑到哪个会话）与手动绑定/解绑；
 *   - 诊断信息与「测试发送」。
 *
 * 与宿主约定（已在 dsh 0.2.1-rc.2 上核实）：
 *   - `ctx.connection.rpc.call(channel, method, payload)` 返回
 *     `{ ok: true, value }` 或 `{ ok: false, error: { message } }`；
 *   - 设置页通过 `ctx.slots.register({ name: 'settings.section', id, order,
 *     label, inject }, Component)` 挂载，`inject` 返回的 `rpcCall` 就是上面的封装；
 *   - 所有颜色/圆角用宿主 `--dsw-*` token，不写死色值，主题切换自动跟随。
 */

window.__ModuleLoader__.load({
  id: '@weniatall/dsh-im-bot',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const react = require('react');

    const SETTINGS_SLOT = 'settings.section';
    const RPC_CHANNEL = '/dsh-im-bot';
    const SECTION_ID = 'im-bot';

    const css = `
      .imb-settings{display:flex;flex-direction:column;gap:16px;width:100%;max-width:820px;padding:4px 0 24px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
      .imb-settings h2,.imb-settings h3,.imb-settings p{margin:0}
      .imb-settings h2{font:var(--dsw-font-l-20);font-weight:600;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
      .imb-intro{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-s-14);line-height:20px}
      .imb-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-l,12px);background:var(--dsw-alias-background-base,var(--dsw-alias-bg-module-platform))}
      .imb-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .imb-card-title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}
      .imb-row{display:flex;gap:12px;flex-wrap:wrap}
      .imb-row>.imb-field{flex:1 1 240px}
      .imb-field{display:flex;flex-direction:column;gap:6px}
      .imb-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px}
      .imb-input,.imb-textarea{box-sizing:border-box;width:100%;padding:0 12px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:8px;outline:none;background:var(--dsw-alias-background-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
      .imb-input{height:36px}
      .imb-textarea{min-height:88px;padding:10px 12px;resize:vertical;line-height:20px;font-family:var(--dsw-font-mono,monospace)}
      .imb-input:focus-visible,.imb-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}
      .imb-input:disabled,.imb-textarea:disabled{opacity:.6;cursor:default}
      .imb-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px}
      .imb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-default,var(--dsw-alias-border-l2));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);cursor:pointer;white-space:nowrap}
      .imb-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent)}
      .imb-btn:disabled{cursor:default;opacity:.5}
      .imb-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
      .imb-btn-danger{border-color:transparent;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 14%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .imb-btn-sm{height:28px;padding:0 10px;border-radius:14px;font-size:12px}
      .imb-status{padding:10px 12px;border-radius:8px;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word}
      .imb-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}
      .imb-status.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .imb-status.info{background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 6%,transparent);color:var(--dsw-alias-label-secondary)}
      .imb-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .imb-tag{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;font-size:11px;line-height:20px;font-weight:500}
      .imb-tag.on{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 16%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}
      .imb-tag.off{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 16%,transparent);color:var(--dsw-alias-label-tertiary,#888)}
      .imb-tag.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84848) 16%,transparent);color:var(--dsw-alias-state-error-primary,#d84848)}
      .imb-tag.warn{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d99a00) 16%,transparent);color:var(--dsw-alias-state-warning-primary,#d99a00)}
      .imb-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:13px;color:var(--dsw-alias-label-secondary)}
      .imb-switch input{width:16px;height:16px;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .imb-qr{display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px;border-radius:var(--dsw-radius-m,10px);background:var(--dsw-alias-bg-layer-1,#fff);border:1px dashed var(--dsw-alias-border-default,var(--dsw-alias-border-l2))}
      .imb-qr img{width:200px;height:200px;object-fit:contain;border-radius:8px;background:#fff}
      .imb-qr a{font-size:12px;color:var(--dsw-alias-brand-primary,#4d6bfe);word-break:break-all;text-align:center}
      .imb-list{display:flex;flex-direction:column;gap:8px}
      .imb-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#000) 4%,transparent);font-size:13px;flex-wrap:wrap}
      .imb-item-main{display:flex;flex-direction:column;gap:2px;min-width:0}
      .imb-item-title{font-weight:500;word-break:break-all}
      .imb-item-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
      .imb-empty{padding:14px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .imb-divider{height:1px;background:var(--dsw-alias-border-subtle,var(--dsw-alias-border-l1));margin:2px 0}
      button:has([data-settings-nav-label="im-bot"]) > svg:first-child{display:none}
    `;

    /** 注入样式（幂等）。 */
    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('dsh-im-bot-style') !== null) return;
      const style = document.createElement('style');
      style.id = 'dsh-im-bot-style';
      style.textContent = css;
      document.head.appendChild(style);
    }

    /** 通道状态 → 标签样式与文案。 */
    function statusTag(status) {
      if (status === 'online') return { cls: 'on', text: '在线' };
      if (status === 'connecting') return { cls: 'warn', text: '连接中' };
      if (status === 'error') return { cls: 'err', text: '异常' };
      return { cls: 'off', text: '未启用' };
    }

    /** 把多行文本拆成去重数组。 */
    function parseList(text) {
      const seen = new Set();
      const out = [];
      for (const line of String(text ?? '').split(/[\n,]/)) {
        const item = line.trim();
        if (item === '' || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
      return out;
    }

    /** 数组 → 多行文本。 */
    function joinList(list) {
      return Array.isArray(list) ? list.join('\n') : '';
    }

    /**
     * 扫码登录卡片：发起、轮询、展示二维码。
     *
     * 轮询用 1.5s 间隔（官方建议的体验节奏），组件卸载或确认后立即停止，
     * 避免用户切走设置页后还在打接口。
     */
    function LoginPanel(props) {
      const { rpcCall, onLoggedIn, initial } = props;
      const [session, setSession] = react.useState(initial ?? null);
      const [busy, setBusy] = react.useState(false);
      const [error, setError] = react.useState('');
      const timerRef = react.useRef(null);

      const stopPolling = react.useCallback(() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }, []);

      react.useEffect(() => stopPolling, [stopPolling]);

      const poll = react.useCallback(async () => {
        try {
          const next = await rpcCall('ilink.login.poll', {});
          setSession(next);
          if (next?.status === 'confirmed') {
            stopPolling();
            onLoggedIn?.(next);
            return;
          }
          if (next?.status === 'error') {
            stopPolling();
            return;
          }
          timerRef.current = setTimeout(() => { void poll(); }, 1500);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          stopPolling();
        }
      }, [rpcCall, onLoggedIn, stopPolling]);

      const start = async () => {
        setBusy(true);
        setError('');
        try {
          const next = await rpcCall('ilink.login.start', {});
          setSession(next);
          if (next?.status !== 'error') {
            timerRef.current = setTimeout(() => { void poll(); }, 1500);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      };

      const cancel = async () => {
        stopPolling();
        try {
          await rpcCall('ilink.login.cancel', {});
        } catch {
          /* 取消失败无所谓 */
        }
        setSession(null);
      };

      const status = session?.status ?? '';
      const running = status === 'wait' || status === 'scaned' || status === 'scaned_but_redirect';

      return react.createElement('div', { className: 'imb-card' },
        react.createElement('div', { className: 'imb-card-head' },
          react.createElement('div', { className: 'imb-card-title' }, '个人微信 · 扫码登录'),
          running
            ? react.createElement('span', { className: 'imb-tag warn' }, session?.message ?? '等待扫码')
            : null,
        ),
        react.createElement('p', { className: 'imb-hint' },
          '使用微信扫描二维码完成登录。凭据只保存在本机 DSH 凭据存储中，不会写入配置文件。'),

        session?.qrcodeUrl
          ? react.createElement('div', { className: 'imb-qr' },
              // 企微/微信的 liteapp URL 本身就是二维码图片地址；直接当图片渲染。
              react.createElement('img', { src: session.qrcodeUrl, alt: '微信登录二维码' }),
              react.createElement('a', { href: session.qrcodeUrl, target: '_blank', rel: 'noreferrer' }, session.qrcodeUrl),
            )
          : null,

        error !== '' ? react.createElement('div', { className: 'imb-status err' }, error) : null,
        session?.message && !running
          ? react.createElement('div', { className: `imb-status ${status === 'error' ? 'err' : 'ok'}` }, session.message)
          : null,

        react.createElement('div', { className: 'imb-actions' },
          running
            ? react.createElement('button', {
                type: 'button', className: 'imb-btn', onClick: cancel,
              }, '取消登录')
            : react.createElement('button', {
                type: 'button', className: 'imb-btn imb-btn-primary', onClick: start, disabled: busy,
              }, busy ? '正在获取二维码…' : '扫码登录'),
        ),
      );
    }

    function ImBotSettings(props) {
      const { rpcCall } = props || {};
      const [loading, setLoading] = react.useState(true);
      const [saving, setSaving] = react.useState(false);
      const [message, setMessage] = react.useState(null);
      const [state, setState] = react.useState(null);

      const [form, setForm] = react.useState({
        enabled: false,
        wecomEnabled: false,
        wecomBotId: '',
        wecomBaseUrl: 'wss://openws.work.weixin.qq.com',
        wecomHeartbeatSeconds: 30,
        ilinkEnabled: false,
        ilinkAccountId: '',
        ilinkBaseUrl: 'https://ilinkai.weixin.qq.com',
        ilinkTyping: true,
        notifyOnTurnComplete: true,
        notifyOnTurnFailure: true,
        notifyMaxNoticeChars: 800,
        accessAllowFrom: '',
        accessGroupAllowFrom: '',
        accessGroupsEnabled: false,
      });
      const [secrets, setSecrets] = react.useState({ wecomSecret: '', ilinkToken: '', httpSecret: '' });

      const reload = react.useCallback(async () => {
        if (!rpcCall) return;
        try {
          const data = await rpcCall('status', {});
          setState(data);
          const config = data?.config ?? {};
          setForm({
            enabled: config.enabled === true,
            wecomEnabled: config.wecom?.enabled === true,
            wecomBotId: config.wecom?.botId ?? '',
            wecomBaseUrl: config.wecom?.baseUrl ?? 'wss://openws.work.weixin.qq.com',
            wecomHeartbeatSeconds: config.wecom?.heartbeatSeconds ?? 30,
            ilinkEnabled: config.ilink?.enabled === true,
            ilinkAccountId: config.ilink?.accountId ?? '',
            ilinkBaseUrl: config.ilink?.baseUrl ?? 'https://ilinkai.weixin.qq.com',
            ilinkTyping: config.ilink?.typing !== false,
            notifyOnTurnComplete: config.notify?.onTurnComplete !== false,
            notifyOnTurnFailure: config.notify?.onTurnFailure !== false,
            notifyMaxNoticeChars: config.notify?.maxNoticeChars ?? 800,
            accessAllowFrom: joinList(config.access?.allowFrom),
            accessGroupAllowFrom: joinList(config.access?.groupAllowFrom),
            accessGroupsEnabled: config.access?.groupsEnabled === true,
          });
        } catch (err) {
          setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
        } finally {
          setLoading(false);
        }
      }, [rpcCall]);

      react.useEffect(() => {
        ensureStyles();
        void reload();
      }, [reload]);

      const update = (key) => (event) => {
        const value = event?.target?.type === 'checkbox' ? event.target.checked : event.target.value;
        setForm((prev) => ({ ...prev, [key]: value }));
      };

      const save = async () => {
        if (!rpcCall) return;
        setSaving(true);
        setMessage(null);
        try {
          const payload = {
            ...form,
            wecomHeartbeatSeconds: Number(form.wecomHeartbeatSeconds) || 30,
            notifyMaxNoticeChars: Number(form.notifyMaxNoticeChars) || 800,
            accessAllowFrom: parseList(form.accessAllowFrom),
            accessGroupAllowFrom: parseList(form.accessGroupAllowFrom),
            secrets: {
              wecomSecret: secrets.wecomSecret,
              ilinkToken: secrets.ilinkToken,
              httpSecret: secrets.httpSecret,
            },
          };
          const data = await rpcCall('save', payload);
          setState(data);
          setSecrets({ wecomSecret: '', ilinkToken: '', httpSecret: '' });
          setMessage({ kind: 'ok', text: '设置已保存' });
        } catch (err) {
          setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
        } finally {
          setSaving(false);
        }
      };

      const testSend = async () => {
        if (!rpcCall) return;
        const first = state?.bindings?.[0];
        if (!first) {
          setMessage({ kind: 'err', text: '还没有任何绑定，先在微信里给机器人发一条消息，或手动绑定一个会话' });
          return;
        }
        try {
          await rpcCall('send', {
            channel: first.channel,
            peer: first.peer,
            text: '🔔 这是一条来自 DSH 集成机器人的测试消息',
            format: 'text',
          });
          setMessage({ kind: 'ok', text: `测试消息已发往 ${first.channel} / ${first.peer}` });
        } catch (err) {
          setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
        }
      };

      const removeBinding = async (binding) => {
        if (!rpcCall) return;
        try {
          await rpcCall('bindings.remove', { channel: binding.channel, peer: binding.peer });
          await reload();
          setMessage({ kind: 'ok', text: '已解除绑定' });
        } catch (err) {
          setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
        }
      };

      const wecomState = state?.channels?.wecom;
      const ilinkState = state?.channels?.ilink;
      const wecomTag = statusTag(wecomState?.status ?? 'idle');
      const ilinkTag = statusTag(ilinkState?.status ?? 'idle');
      const bindings = Array.isArray(state?.bindings) ? state.bindings : [];

      if (loading) {
        return react.createElement('div', { className: 'imb-settings' },
          react.createElement('h2', null, '集成机器人'),
          react.createElement('div', { className: 'imb-status info' }, '正在读取配置…'),
        );
      }

      return react.createElement('div', { className: 'imb-settings' },
        react.createElement('h2', null, '集成机器人'),
        react.createElement('p', { className: 'imb-intro' },
          '把企业微信智能机器人或个人微信接入 DSH：微信里发消息驱动会话，会话跑完自动把结果推回微信。'),

        // 总开关
        react.createElement('div', { className: 'imb-card' },
          react.createElement('div', { className: 'imb-card-head' },
            react.createElement('div', { className: 'imb-card-title' }, '总开关'),
            react.createElement('span', {
              className: `imb-tag ${form.enabled ? 'on' : 'off'}`,
            }, form.enabled ? '已启用' : '已停用'),
          ),
          react.createElement('label', { className: 'imb-switch' },
            react.createElement('input', { type: 'checkbox', checked: form.enabled, onChange: update('enabled') }),
            '启用集成机器人（关闭后不会建立任何连接）',
          ),
        ),

        // 企业微信
        react.createElement('div', { className: 'imb-card' },
          react.createElement('div', { className: 'imb-card-head' },
            react.createElement('div', { className: 'imb-card-title' }, '企业微信智能机器人'),
            react.createElement('span', { className: `imb-tag ${wecomTag.cls}` }, wecomTag.text),
          ),
          react.createElement('p', { className: 'imb-hint' },
            '在企业微信管理后台 → 智能机器人 → 开启「API 模式」并选择「长连接」，取得 BotID 与 Secret。长连接无需公网地址。'),
          wecomState?.lastError
            ? react.createElement('div', { className: 'imb-status err' }, wecomState.lastError)
            : null,
          react.createElement('label', { className: 'imb-switch' },
            react.createElement('input', { type: 'checkbox', checked: form.wecomEnabled, onChange: update('wecomEnabled') }),
            '启用企业微信通道',
          ),
          react.createElement('div', { className: 'imb-row' },
            react.createElement('div', { className: 'imb-field' },
              react.createElement('span', { className: 'imb-label' }, 'BotID'),
              react.createElement('input', {
                className: 'imb-input', value: form.wecomBotId, onChange: update('wecomBotId'),
                placeholder: '智能机器人的 BotID', spellCheck: false,
              }),
            ),
            react.createElement('div', { className: 'imb-field' },
              react.createElement('span', { className: 'imb-label' },
                'Secret',
                state?.credentials?.wecomSecret
                  ? react.createElement('span', { className: 'imb-tag on' }, '已保存')
                  : react.createElement('span', { className: 'imb-tag off' }, '未配置'),
              ),
              react.createElement('input', {
                className: 'imb-input', type: 'password', value: secrets.wecomSecret,
                onChange: (event) => setSecrets((prev) => ({ ...prev, wecomSecret: event.target.value })),
                placeholder: state?.credentials?.wecomSecret ? '留空表示不修改' : '长连接专用 Secret',
                spellCheck: false,
              }),
            ),
          ),
          react.createElement('div', { className: 'imb-row' },
            react.createElement('div', { className: 'imb-field' },
              react.createElement('span', { className: 'imb-label' }, '长连接地址'),
              react.createElement('input', {
                className: 'imb-input', value: form.wecomBaseUrl, onChange: update('wecomBaseUrl'),
                spellCheck: false,
              }),
            ),
            react.createElement('div', { className: 'imb-field' },
              react.createElement('span', { className: 'imb-label' }, '心跳间隔（秒）'),
              react.createElement('input', {
                className: 'imb-input', type: 'number', min: 5, max: 300,
                value: form.wecomHeartbeatSeconds, onChange: update('wecomHeartbeatSeconds'),
              }),
            ),
          ),
        ),

        // 个人微信
        react.createElement('div', { className: 'imb-card' },
          react.createElement('div', { className: 'imb-card-head' },
            react.createElement('div', { className: 'imb-card-title' }, '个人微信'),
            react.createElement('span', { className: `imb-tag ${ilinkTag.cls}` }, ilinkTag.text),
          ),
          react.createElement('p', { className: 'imb-hint' },
            '通过腾讯 iLink Bot 官方接口接入，需要扫码登录。登录后该账号即可收发消息。'),
          ilinkState?.lastError
            ? react.createElement('div', { className: 'imb-status err' }, ilinkState.lastError)
            : null,
          react.createElement('div', { className: 'imb-row' },
            react.createElement('div', { className: 'imb-field' },
              react.createElement('span', { className: 'imb-label' }, '账号 ID'),
              react.createElement('input', {
                className: 'imb-input', value: form.ilinkAccountId, onChange: update('ilinkAccountId'),
                placeholder: '扫码登录后自动填入', spellCheck: false,
              }),
            ),
            react.createElement('div', { className: 'imb-field' },
              react.createElement('span', { className: 'imb-label' },
                'Token',
                state?.credentials?.ilinkToken
                  ? react.createElement('span', { className: 'imb-tag on' }, '已保存')
                  : react.createElement('span', { className: 'imb-tag off' }, '未配置'),
              ),
              react.createElement('input', {
                className: 'imb-input', type: 'password', value: secrets.ilinkToken,
                onChange: (event) => setSecrets((prev) => ({ ...prev, ilinkToken: event.target.value })),
                placeholder: state?.credentials?.ilinkToken ? '留空表示不修改' : '扫码登录后自动保存',
                spellCheck: false,
              }),
            ),
          ),
          react.createElement('label', { className: 'imb-switch' },
            react.createElement('input', { type: 'checkbox', checked: form.ilinkEnabled, onChange: update('ilinkEnabled') }),
            '启用个人微信通道',
          ),
        ),

        react.createElement(LoginPanel, {
          rpcCall,
          initial: state?.login ?? null,
          onLoggedIn: () => { void reload(); },
        }),

        // 白名单
        react.createElement('div', { className: 'imb-card' },
          react.createElement('div', { className: 'imb-card-title' }, '访问白名单'),
          react.createElement('p', { className: 'imb-hint' },
            '留空表示拒绝所有人（安全默认）。每行一个 ID。单聊填对方 userid；群聊需同时开启群聊并填群 ID。'),
          react.createElement('div', { className: 'imb-field' },
            react.createElement('span', { className: 'imb-label' }, '允许的单聊 userid'),
            react.createElement('textarea', {
              className: 'imb-textarea', value: form.accessAllowFrom,
              onChange: update('accessAllowFrom'),
              placeholder: '每行一个 userid',
              spellCheck: false,
            }),
          ),
          react.createElement('label', { className: 'imb-switch' },
            react.createElement('input', { type: 'checkbox', checked: form.accessGroupsEnabled, onChange: update('accessGroupsEnabled') }),
            '允许群聊（群内 @ 机器人）',
          ),
          form.accessGroupsEnabled
            ? react.createElement('div', { className: 'imb-field' },
                react.createElement('span', { className: 'imb-label' }, '允许的群 ID'),
                react.createElement('textarea', {
                  className: 'imb-textarea', value: form.accessGroupAllowFrom,
                  onChange: update('accessGroupAllowFrom'),
                  placeholder: '每行一个群 ID（chatid）',
                  spellCheck: false,
                }),
              )
            : null,
        ),

        // 通知
        react.createElement('div', { className: 'imb-card' },
          react.createElement('div', { className: 'imb-card-title' }, '任务完成通知'),
          react.createElement('p', { className: 'imb-hint' },
            '只推给「发起过对话」的聊天，不会打扰其它人。'),
          react.createElement('label', { className: 'imb-switch' },
            react.createElement('input', { type: 'checkbox', checked: form.notifyOnTurnComplete, onChange: update('notifyOnTurnComplete') }),
            '回合完成时推送结果摘要',
          ),
          react.createElement('label', { className: 'imb-switch' },
            react.createElement('input', { type: 'checkbox', checked: form.notifyOnTurnFailure, onChange: update('notifyOnTurnFailure') }),
            '回合失败/中断时推送告警',
          ),
          react.createElement('div', { className: 'imb-row' },
            react.createElement('div', { className: 'imb-field' },
              react.createElement('span', { className: 'imb-label' }, '摘要最大字符数（100–4000）'),
              react.createElement('input', {
                className: 'imb-input', type: 'number', min: 100, max: 4000,
                value: form.notifyMaxNoticeChars, onChange: update('notifyMaxNoticeChars'),
              }),
            ),
          ),
        ),

        // 通用发送 token
        react.createElement('div', { className: 'imb-card' },
          react.createElement('div', { className: 'imb-card-title' }, '外部调用令牌（可选）'),
          react.createElement('p', { className: 'imb-hint' },
            '配置后可通过 POST /dsh-im-bot/send 让其它脚本主动推消息；不配置则该接口不存在。'),
          react.createElement('div', { className: 'imb-field' },
            react.createElement('span', { className: 'imb-label' }, 'HTTP 令牌'),
            react.createElement('input', {
              className: 'imb-input', type: 'password', value: secrets.httpSecret,
              onChange: (event) => setSecrets((prev) => ({ ...prev, httpSecret: event.target.value })),
              placeholder: '留空表示不修改；设置后立即生效',
              spellCheck: false,
            }),
          ),
        ),

        // 绑定列表
        react.createElement('div', { className: 'imb-card' },
          react.createElement('div', { className: 'imb-card-head' },
            react.createElement('div', { className: 'imb-card-title' }, `聊天绑定（${bindings.length}）`),
            react.createElement('button', {
              type: 'button', className: 'imb-btn imb-btn-sm', onClick: () => { void reload(); },
            }, '刷新'),
          ),
          bindings.length === 0
            ? react.createElement('div', { className: 'imb-empty' },
                '还没有绑定。在微信里给机器人发 /new 即可新建并绑定一个会话。')
            : react.createElement('div', { className: 'imb-list' },
                bindings.map((binding) => react.createElement('div', {
                  className: 'imb-item', key: binding.peerKey,
                },
                  react.createElement('div', { className: 'imb-item-main' },
                    react.createElement('span', { className: 'imb-item-title' },
                      `${binding.channel === 'wecom' ? '企业微信' : '个人微信'} · ${binding.peer}`),
                    react.createElement('span', { className: 'imb-item-sub' },
                      `会话 ${String(binding.sessionId).slice(0, 8)} · ${binding.chatType === 'group' ? '群聊' : '单聊'} · 通知${binding.notify ? '开' : '关'}`),
                  ),
                  react.createElement('button', {
                    type: 'button', className: 'imb-btn imb-btn-sm imb-btn-danger',
                    onClick: () => { void removeBinding(binding); },
                  }, '解除'),
                )),
              ),
        ),

        message !== null
          ? react.createElement('div', { className: `imb-status ${message.kind === 'ok' ? 'ok' : 'err'}` }, message.text)
          : null,

        react.createElement('div', { className: 'imb-actions' },
          react.createElement('button', {
            type: 'button', className: 'imb-btn', onClick: testSend, disabled: saving,
          }, '测试发送'),
          react.createElement('button', {
            type: 'button', className: 'imb-btn', onClick: () => { void reload(); }, disabled: saving,
          }, '重新读取'),
          react.createElement('button', {
            type: 'button', className: 'imb-btn imb-btn-primary', onClick: save, disabled: saving,
          }, saving ? '保存中…' : '保存设置'),
        ),
      );
    }

    /**
     * 侧边栏图标（对话气泡 + 连接线，表示「双向」）。
     * @returns {any}
     */
    function IconBot16() {
      return react.createElement('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', focusable: 'false',
      },
        react.createElement('path', {
          d: 'M3 6.5A2.5 2.5 0 0 1 5.5 4h5A2.5 2.5 0 0 1 13 6.5v2A2.5 2.5 0 0 1 10.5 11H8l-2.4 2V11H5.5A2.5 2.5 0 0 1 3 8.5v-2Z',
          stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round',
        }),
        react.createElement('circle', { cx: 6, cy: 7.2, r: 0.9, fill: 'currentColor' }),
        react.createElement('circle', { cx: 10, cy: 7.2, r: 0.9, fill: 'currentColor' }),
      );
    }

    /**
     * 插件入口。
     * @param {any} ctx
     */
    function apply(ctx) {
      ensureStyles();

      const rpcCall = async (method, payload) => {
        const connection = ctx && ctx.connection;
        const rpc = connection && connection.rpc;
        if (!rpc || typeof rpc.call !== 'function') throw new Error('连接服务尚未就绪');
        const result = await rpc.call(RPC_CHANNEL, method, payload || {});
        if (result && result.ok === true) return result.value;
        throw new Error(result?.error?.message
          || (typeof result?.error === 'string' ? result.error : '请求失败'));
      };

      const label = () => react.createElement('span', {
        'data-settings-nav-label': SECTION_ID,
        style: { display: 'inline-flex', alignItems: 'center', gap: 8 },
      },
        react.createElement(IconBot16, null),
        '集成机器人',
      );

      ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
        name: SETTINGS_SLOT,
        id: SECTION_ID,
        order: 36,
        label,
        inject: () => ({ rpcCall }),
      }, ImBotSettings));
    }

    exports.apply = apply;
    exports.inject = ['slots', 'connection'];
    exports.ImBotSettings = ImBotSettings;
    exports.LoginPanel = LoginPanel;
    exports.parseList = parseList;
    return module.exports;
  },
});
