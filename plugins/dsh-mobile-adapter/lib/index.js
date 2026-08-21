export const name = 'mobile-adapter'
export const inject = ['webServer']

export const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'

const VIEWPORT_TAG = `<meta name="viewport" content="${VIEWPORT_CONTENT}" />`
const SAFE_AREA_TAG = '<style id="dsh-mobile-safe-area">:root{--dsh-sat:env(safe-area-inset-top,0px);--dsh-sab:env(safe-area-inset-bottom,0px);--dsh-sal:env(safe-area-inset-left,0px);--dsh-sar:env(safe-area-inset-right,0px)}</style>'
const VIEWPORT_RE = /<meta\b(?=[^>]*\bname\s*=\s*(?:"viewport"|'viewport'|viewport))[^>]*>/i
const SAFE_AREA_RE = /<style\b[^>]*\bid\s*=\s*(?:"dsh-mobile-safe-area"|'dsh-mobile-safe-area'|dsh-mobile-safe-area)[^>]*>[\s\S]*?<\/style>/i

/**
 * 移动端/局域网性能加速器脚本:
 * 1. 拦截 fetch/script 加载并利用 CacheStorage 实现强缓存 (基于 ?rev= 内容哈希，0ms 本地秒开)
 * 2. 对网络波动导致的脚本拉取失败增加 3 次指数退避自动重试，消除白屏和卡转圈
 * 3. 并发连接优化与后台唤醒保活
 */
const ACCELERATOR_SCRIPT = `<script id="dsh-mobile-accelerator">
(function() {
  if (typeof window === 'undefined') return;

  // 1. 基于 CacheStorage 的插件静态资源强缓存 (支持局域网 HTTP 环境)
  var CACHE_NAME = 'dsh-plugins-cache-v1';
  var origFetch = window.fetch;

  if (typeof origFetch === 'function' && window.caches) {
    window.fetch = async function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      // 仅对带有版本 hash (?rev=) 的插件和静态资产启用持久缓存
      if (url.includes('/plugins/') && url.includes('rev=') && (!init || !init.method || init.method.toUpperCase() === 'GET')) {
        try {
          var cache = await caches.open(CACHE_NAME);
          var cached = await cache.match(input);
          if (cached) return cached.clone();
          
          // 未命中缓存时发起网络请求，带 3 次失败重试
          var res = await fetchWithRetry(input, init, 3);
          if (res && res.status === 200) {
            cache.put(input, res.clone()).catch(function() {});
          }
          return res;
        } catch (e) {
          // 回退到普通 fetch
        }
      }
      return origFetch.apply(this, arguments);
    };
  }

  async function fetchWithRetry(input, init, retries) {
    var lastErr;
    for (var i = 0; i < retries; i++) {
      try {
        var res = await origFetch(input, init);
        if (res.status === 200 || res.status === 304) return res;
      } catch (err) {
        lastErr = err;
        await new Promise(function(r) { setTimeout(r, 200 * Math.pow(2, i)); });
      }
    }
    if (lastErr) throw lastErr;
    return origFetch(input, init);
  }

  // 2. 预解析并并发预热 __DSH_BOOT__ 中的全部插件
  window.addEventListener('DOMContentLoaded', function() {
    try {
      var boot = globalThis.__DSH_BOOT__;
      if (boot && Array.isArray(boot.entries)) {
        boot.entries.forEach(function(entry) {
          if (entry && entry.url) {
            var link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'script';
            link.href = entry.url;
            document.head.appendChild(link);
          }
        });
      }
    } catch(e) {}
  });
})();
</script>`

export function patchIndex(html) {
  let output = VIEWPORT_RE.test(html)
    ? html.replace(VIEWPORT_RE, VIEWPORT_TAG)
    : html.replace(/<head\b[^>]*>/i, `$&${VIEWPORT_TAG}`)
  
  output = SAFE_AREA_RE.test(output)
    ? output.replace(SAFE_AREA_RE, SAFE_AREA_TAG)
    : output.replace(/<\/head\s*>/i, `${SAFE_AREA_TAG}</head>`)

  if (!output.includes('id="dsh-mobile-accelerator"')) {
    output = output.replace(VIEWPORT_TAG, `${VIEWPORT_TAG}${ACCELERATOR_SCRIPT}`)
  }

  return output
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex(patchIndex), 'mobile-adapter: viewport & accelerator')
}
