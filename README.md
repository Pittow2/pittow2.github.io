# 如何免备案发布带域名的动态网站

## 0. 简介

如果你拥有一个中国大陆公网 IP 和一个域名，但无法进行 ICP 备案，用户使用域名访问网站时会被拦截。本项目借助免费的静态站部署服务和 iframe 技术，使用户能够从域名访问网站。

## 1. URL 映射

| 项目 | 地址 |
| --- | --- |
| 外层站 | `https://outer.example` |
| 内层站 | `https://inner.example` |

外层服务器需要对 `https://outer.example` 下所有路径返回同一份 HTML，在 `github.io` 上可以通过 `404.html` 实现。

如果无法做到这一点，请不要执行本文档的 `2. 内层每个 HTML 的 head 代码`。

URL 按 path、query、fragment 对应：

```text
https://outer.example/xxx?q=1#part
https://inner.example/xxx?q=1#part
```

外层自动同步内层的 path、query 和 fragment，origin 保持为 `outer.example`。

实际实现时，根据第 2,3 点，将 `js` 代码和反代头中的 `outer.example` 替换成你的实际域名。

## 2. 内层每个 HTML 的 head 代码

以下 `iframe.js` 代码用于向外层站同步 URL 和窗口标题：

```js
(() => {
  "use strict";

  const OUTER_ORIGIN = "https://outer.example";
  let lastState = "";

  function sendState() {
    const state = location.href + "\n" + document.title;

    if (state === lastState) {
      return;
    }

    lastState = state;
    parent.postMessage(
      {
        href: location.href,
        title: document.title
      },
      OUTER_ORIGIN
    );
  }

  const pushState = history.pushState;
  const replaceState = history.replaceState;

  history.pushState = function (...args) {
    const result = pushState.apply(this, args);
    sendState();
    return result;
  };

  history.replaceState = function (...args) {
    const result = replaceState.apply(this, args);
    sendState();
    return result;
  };

  sendState();
  window.addEventListener("pageshow", sendState);
  window.addEventListener("popstate", sendState);
  window.addEventListener("hashchange", sendState);

  new MutationObserver(sendState).observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
```

该代码在页面加载、History API 路由、前进后退、fragment 和标题变化后发送 URL 与标题。跳转前不发送。

每个 HTML 需要在 `<title>` 后、业务脚本前加载：

```html
<script src="/iframe.js"></script>
```

## 3. CSP 头（推荐反向代理）

推荐由内层站的反向代理统一添加：

```http
Content-Security-Policy: frame-ancestors https://outer.example
```

同时移除会导致跨源嵌入失败的 `X-Frame-Options`。如果上游已有 CSP，保留原有策略，将 `frame-ancestors` 作为另一条策略添加；多条 CSP 会同时生效，因此上游不能再包含冲突的 `frame-ancestors`。

如果内层站需要执行更多 iframe 嵌套，所有子页面全都要添加该 CSP 头。

### Caddy

```caddyfile
inner.example {
    reverse_proxy 127.0.0.1:8080 {
        header_down +Content-Security-Policy "frame-ancestors https://outer.example"
        header_down -X-Frame-Options
    }
}
```

`+Content-Security-Policy` 保留上游已有 CSP 并追加一条新策略。

### Nginx

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_hide_header X-Frame-Options;
    add_header Content-Security-Policy "frame-ancestors https://outer.example" always;
}
```

如果当前 `location` 已有其他 `add_header`，需要把它们放在同一处，避免 Nginx 的指令继承规则导致响应头丢失。

## 4. postMessage 协议

跳转完成或标题变化后发送：

```js
parent.postMessage(
  {
    href: location.href,
    title: document.title
  },
  "https://outer.example"
);
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `href` | string | 当前内层完整 URL |
| `title` | string | 当前 `document.title` |

外层收到后执行：

```js
history.replaceState(null, "", mirroredOuterPath);
document.title = title;
```

这不会重载外层页面、请求外层服务器或新增历史记录。

## 5. 注意事项

内层页面不得依赖 `window.top` 实现。

如果内层页面需要在新窗口中跳转，请主动将源修改为 `outer.example`。

## 6. 部署方式（推荐 Github）

可以使用 Github Pages 部署：将 HTML 文件重命名为 404.html ，放在你的站点根下，删除所有其他文件，包括 README.md 。使用 Pages 发布站点。此时 `outer.example` 应为 `<username>.github.io` 。

自定义域名：参考 Github 文档设置域名和 DNS 记录，随后使用 Github Actions 的 Static HTML workflow 部署。推荐将 `jobs.deploy.steps.with.path` 改为你的仓库下的一个子目录，并把 404.html 移动进去。此时 `outer.example` 应为你的自定义域名。

内层站：推荐使用 Caddy/Nginx 反代，否则需要在后端代码中添加 CSP 头。需要有 TLS 证书：从 2026 年起，Let's Encrypt 允许把证书颁发给 IP 地址，Caddy/Nginx 会自动完成证书申请。

## 7. 其他问题

内层跳转时，外层不能强制收到新 URL 或标题。外层无法读取跨源新页面。只有新源页面自己执行上述 `postMessage`，外层才能收到。

外层调用 `iframe` 时没有使用 `sandbox`，没有声明 `allow`。你可以编辑 HTML 代码修改这一点。

和普通部署一样，带宽瓶颈是内层站的服务器。Github 等静态托管站只负责加载一个 HTML。但如果用户到托管站的连接质量过于差，仍会导致启动时缓慢。
