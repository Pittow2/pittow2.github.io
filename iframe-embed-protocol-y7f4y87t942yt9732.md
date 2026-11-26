# 跨源 iframe URL 与标题同步协议

## 1. URL 映射

| 项目 | 地址 |
| --- | --- |
| 外层站 | `https://outer.example` |
| 内层站 | `https://inner.example` |

外层服务器对 `https://outer.example` 下所有路径返回同一份 `index.html`。
在 `github.io` 上可以通过 `404.html` 实现。
URL 按 path、query、fragment 对应：

```text
https://outer.example/xxx?q=1#part
https://inner.example/xxx?q=1#part
```

外层不能在不导航的情况下把 origin 改成 `inner.example`，因此只同步
path、query 和 fragment，origin 保持为 `outer.example`。

## 2. 内层每个 HTML 的 head 代码

把以下代码放在内层每个 HTML 的 `<title>` 后、业务脚本前：

```html
<script>
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
</script>
```

该代码在页面加载、History API 路由、前进后退、fragment 和标题变化后
发送 URL 与标题。相同 URL 和标题只发送一次。跳转前不发送。

如果 CSP 禁止内联脚本，应将代码放到公共 JS 文件，或为 `<script>`
配置 nonce。

## 3. CSP 由反向代理添加

推荐由内层站的反向代理统一添加：

```http
Content-Security-Policy: frame-ancestors https://outer.example
```

同时移除会导致跨源嵌入失败的 `X-Frame-Options`。如果上游已有 CSP，
保留原有策略，将 `frame-ancestors` 作为另一条策略添加；多条 CSP 会同时
生效，因此上游不能再包含冲突的 `frame-ancestors`。

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

如果当前 `location` 已有其他 `add_header`，需要把它们放在同一处，避免
Nginx 的指令继承规则导致响应头丢失。

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

这不会重载外层页面，不会请求外层服务器，也不会新增历史记录。

## 5. 其他源

内层跳转到其他源时，外层不能强制收到新 URL 或标题。旧页面 JavaScript
会销毁，外层也无法读取跨源新页面。

只有新源页面自己执行上述 `postMessage`，外层才能收到。不可修改的第三方
页面无法强制执行。

## 6. 当前外层实现

外层没有使用 `sandbox`，没有声明 `allow`，也没有校验消息来源、
`event.source` 或字段结构。任何能向该窗口发送 `{ href, title }` 的页面
都可以更新外层 URL 和标题。
