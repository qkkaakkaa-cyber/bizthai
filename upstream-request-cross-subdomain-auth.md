# WooCMS 通用技术需求:同一站点跨多主机名(子域名)的登录态共享

> 面向任意 WooCMS 租户的通用能力请求,不含具体业务词。
> 提报日期:2026-06-24。

## 1. 通用问题

一个 WooCMS 实例经常需要**用多个主机名对外服务同一个站点**,最常见的是**多语言子域名**:
`a.example.com` / `b.example.com` / `c.example.com` 指向同一个 WooCMS 进程、同一套数据与会员体系,只是按 Host 渲染不同语言。对访客而言它们是「同一个网站」。

但目前**会话 cookie 是 host-only**(服务端 `setSameSiteCookie(...)` 不下发 `Domain` 属性,也没有可配置项),因此:

- 用户在 `c.example.com` 登录后,cookie 只作用于 `c.example.com`;
- 切换语言跳到 `a.example.com` 时浏览器不携带该 cookie → **被判定为未登录**,必须重新登录。

这违背「同一站点」的用户预期,且每个语言子站都要单独登录一次。

## 2. 为什么不能简单放宽 cookie 域

常规做法是把 cookie 的 `Domain` 设为共同父域(如 `.example.com`)。但在**多租户部署**下(同一台机器上 `*.example.com` 还托管着其它互不信任的租户实例),`Domain=.example.com` 会把会话令牌**发送给该父域下的所有主机**,令牌可被同父域的其它租户截获/重放 —— 不可接受。

且三个语言子域名**没有比注册域更窄的共同后缀**(`a/b/c` 是平级标签),所以「设一个恰好只覆盖这三个主机的 cookie 域」在 cookie 机制上做不到。

反代层注入也走不通:host-only 的 `Set-Cookie` 没有 `Domain` 可改,标准 nginx(无 headers_more/lua)无法为其追加 `Domain`。

因此这是一个**需要 WooCMS 自身提供**的能力。

## 3. 建议的能力(任选其一或组合,命名中立)

### 方案 A:可配置会话 cookie 作用域 + 主机名允许清单
- 新增站点级配置(`system_settings`,与现有 `auth.*` 同机制即可),例如:
  - `auth.cookie.domain`:显式指定会话/CSRF cookie 的 `Domain`(留空=保持当前 host-only 行为,向后兼容)。
  - `auth.cookie.shared_hosts`:该站点视为「同一站点」的主机名清单(精确主机名数组)。
- 服务端在签发/校验会话时,**仅当请求 Host ∈ shared_hosts 才接受/续期该会话**,从而即便 `Domain` 放宽,令牌也只在登记过的主机间有效,降低多租户泄露面。
- 收益:运维可把「同站多主机」显式声明清楚,既共享登录又不波及其它租户。

### 方案 B:内置跨主机 SSO 桥(无需放宽 cookie 域)
保持 cookie host-only,新增一对端点:
- `POST /api/site/v1/auth/sso/issue`:在**已登录**的主机上,为目标主机签发一个**一次性、短时效、绑定目标 Host 的签名令牌**;目标 Host 必须在站点配置的允许清单内。
- `GET/POST /api/site/v1/auth/sso/consume?token=...`:在**目标主机**上消费该令牌、建立本主机的会话(下发本主机 host-only cookie)。
- 前端(或 WooCMS 自身)在跨主机导航且本主机未登录时,静默走一次 `issue → 重定向 → consume` 即可无感继续登录态。
- 收益:不依赖 cookie 域放宽,天然不泄露给其它租户;允许清单按站点配置。

### 方案 C:站点「主机别名(host aliases)」一等公民
把「同一站点的多个主机名」建模为站点别名(site aliases)。会话以服务端令牌为准、按 token 查库,WooCMS 在用户首次访问某别名主机时透明地用方案 B 的桥为该主机补发 host-only cookie。对运维只需登记别名,对用户完全无感。

## 4. 约束与兼容性

- 默认行为保持不变(`auth.cookie.domain` 留空 = 现状 host-only),不影响既有单主机租户。
- 现有 cookie 为 `HttpOnly + Secure + SameSite=Strict`;跨同注册域子域名的**顶层导航**在 `SameSite=Strict` 下仍会携带 cookie,故只要作用域/桥到位即可工作,无需放宽 SameSite。
- 多语言/单语言子域名特性若在同期设计,建议与本需求**一并考虑**(同站多主机是它们的共同底座)。

## 5. 落地后可回收的本地绕过

本项目当前**未做**任何本地绕过(没有放宽 cookie 域、没有自建 SSO),按用户决定**暂缓实装、等待上游**。上游一旦提供上述任一能力,本项目直接采用即可,无历史包袱。
