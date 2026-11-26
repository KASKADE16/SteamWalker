# Steam Walker

把你的 Steam 库铺成一条按年份往回走的走廊。每一款游戏是一只猫：毛量是好评率，体型是总时长，花色是类型，头顶的星是成就，脖子上的花环和身后的十字架是你的推荐与不推荐。走近它，它会告诉你你们之间发生过什么。

## 运行

最省事：双击 `start.bat`，它会启动本地服务器并打开 http://127.0.0.1:8765/ 。

手动启动：

```bash
py -3 server.py
```

然后打开 http://127.0.0.1:8765/ 。

- **只看默认库**：直接双击 `index.html` 也可以（数据在 `library.js`，`file://` 完全可用）。
- **看别人的公开库**：Steam 不给 `steamcommunity.com` 发 CORS 头，浏览器读不到，所以需要 `server.py` 的只读代理。`start.bat` 会一并启动。
- **GitHub Pages**：纯静态托管，没有代理，在线版只展示默认的 Kaskade_16 走廊；开始界面的公开库输入仍会出现，但在网页版查不了。

## 操作

| 键 | 作用 |
| --- | --- |
| W A S D / 方向键 | 行走 |
| Shift | 奔跑 |
| E | 走近一只猫后打开菜单：说话 / 跟随 / 让两只猫互动；面对跟随的猫可让它回去 |
| 1–9 | 选择菜单项 |
| G | 让当前跟随的猫回到原位 |
| Esc | 关闭菜单 / 松开鼠标 |
| M | 音乐静音（猫叫不受影响） |

走近 3.4 米内并面朝一只猫时会浮出对话卡；按 E 先听到一声猫叫，再打开菜单。

## 走廊里有什么

- **11 段，2026 → 2016**：339 款游戏、10,688 小时，按入库年份排开。
- **跟随**：菜单第二项让猫沿你实际走过的路线跟在身后（同一时间只带一只）；按 G 或菜单里的「让 TA 回去」送它回家。
- **两只猫互动**：身后带着猫时去和另一只说话，菜单会多出「让 A 和 B 互动」，并按双方数据的趋同率判定**贴贴**或**打架**，持续 10 秒。
- **路过**：4.8 米内、玩过 2 小时以上的猫会转头看你；从没打开过的猫有 10% 概率朝你哈气。

## 公开库

开始界面有一个输入框，粘贴 Steam 个人资料链接（`https://steamcommunity.com/id/...` 或 `https://steamcommunity.com/profiles/<17 位 ID>`），按「查看」。

- **公开且有游戏**：读取公开的 `games?xml=1`，用这个账号重新生成走廊。
- **私密 / 隐藏 / 没有公开游戏**：显示「那是座封闭花园」。
- **网络或代理失败**：显示「花园的门暂时打不开，等一下再试。」

公开 XML 只有 appid、名字、时长，所以外账号的走廊会全部落在 2026、类型 Unknown、毛色偏灰，没有星星/花环/十字架，对话里的最后游玩、成就、好评会留空。进入别人的库后，输入框下面会出现「← 回到默认账号的走廊」。代理只放行 `steamcommunity.com`，只读、不登录、不写回 Steam。

## 风格

2026 年 11 月起，走廊改成**碧海甲板**：青绿海面、每两个年度之间的白色马赛克门槛、两侧白栏杆、浅青天空。海面是实时着色器（波纹、菲涅耳反射、阳光碎光、雾），配色取自 **《Waterfall - Spa》** 所在专辑 **《Trademarks & Copyrights》** 的封面。

## 数据

- **339 款游戏，10,688 小时**，入库年份 2016—2026。
- 来源：`IPlayerService/GetOwnedGames`（游戏列表与时长）、`GetPlayerAchievements`（成就）、商店页好评率、`steamcommunity.com/id/HeresyFire/recommended`（你的 47 推荐 / 3 不推荐）、`store.steampowered.com/account/licenses/`（563 条许可）。
- **36 款**查不到入库日期（零售 Key / 礼物 / 已移除），统一放在 2016；它们在对话里会说「我不记得你是什么时候把我加进来的」。
- 其余细节（年份分布、许可覆盖、着色器、猫叫合成、音乐循环）见 [DEVLOG.md](DEVLOG.md)。

## 授权与参考

- 猫模型：**Cat** by **Poly by Google**，[CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)，via [Poly Pizza](https://poly.pizza/m/6dM1J6f6pm9)。本地授权原文在 `Cats/Cat by Poly by Google [CC-BY] via Poly Pizza.md`。
- 音乐：**《Waterfall - Spa》**，来自 **Trademarks & Copyrights**；无缝循环版内嵌在 `bgm-data.js`（`bgm-loop.ogg` 是文件版兜底）。
- 参考：[The Pudding — Life after death?](https://pudding.cool/2026/10/lifeafter/) by Alvin Chang。

## 文件

- `index.html` — 全部逻辑与样式（three.js r128，无构建）
- `library.js` — `window.KASKADE`，339 条数据
- `server.py` — 本地静态服务器 + 只读 Steam 公开页代理（`/api/steam`）
- `start.bat` — 双击启动服务器并打开页面
- `three.min.js` — 本地依赖
- `cat-mesh.js` — 猫的几何体（从 GLB 抽取，供 `index.html` 实例化）
- `bgm-data.js` — 无缝循环音频（Base64 内嵌，主播放源）
- `bgm-loop.ogg` — 同一条音轨的文件版（兜底）
- `Cats/` — 猫模型与 CC-BY 授权原文
- `DEVLOG.md` — 开发日志

## 开发日志

怎么做的、为什么这么做，都在 [DEVLOG.md](DEVLOG.md)。
