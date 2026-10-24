# Skill 使用规范

项目级 UI／UX 辅助 Skill 位于 `.agents/skills/ui-ux-pro-max/`，它是设计与开发工具，不是小程序运行依赖。本文规定使用边界；安装来源、选型和历史验证见开发库的 [安装与整理记录](../../开发库/开发日志/2026-10-24-设计Skill安装与规范整理记录.md)。

## 1. 规则优先级

用户要求、根 `AGENTS.md`、已确认的业务规则和本目录规范优先于外部 Skill 建议。颜色来自 [设计 Token](design-tokens.json)，组件与交互分别遵守 02、04；不能用一次检索结果替代正式规范。

## 2. 原生小程序适配

| 上游常见建议 | 本项目规则 |
| --- | --- |
| React／Tailwind／shadcn 等 stack | 使用原生 WXML／WXSS／JS，不引入前端框架或 DOM API |
| Google Fonts／英文展示字体 | 使用系统中文字体，不引入在线字体 |
| SVG／Web 图标包 | 优先现有图标管理器及已验证图片；新增格式须符合微信兼容目标并有可用回退 |
| hover、cursor、浏览器键盘／ARIA 示例 | 转化为可见按下态、原生控件和受支持的无障碍属性 |
| CSS px、iOS pt、Android dp 尺寸 | 不混用单位；本项目独立点击热区实际至少 48px×48px，rpx 按窗口宽度核算 |
| GSAP、复杂转场、玻璃与发光 | 使用 01 规定的轻量 WXSS 动效及无动效表现 |
| 营销 Hero、价格与转化模块 | 以报修和成员任务组织信息，不套用营销页结构 |
| 默认配色和技术栈猜测 | 品牌主蓝固定为 `#0369D7`，沿用同源色阶和语义映射，不接受 stack 猜测 |
| 自动持久化 `design-system/*/MASTER.md` | 不建立第二套设计真相源，正式范式统一维护在本目录 |

## 3. 检索规则

围绕一个可观察的问题检索，核对结果的平台、类别和适用范围。当前 Skill 没有原生微信小程序专用 stack，只采用经过筛选的通用领域建议，不能用网页 stack 冒充小程序实现指导。没有匹配结果时明确说明，不能编造检索结论。

脚本使用实际项目路径，不照抄上游 `${CLAUDE_PLUGIN_ROOT}`。仓库根目录下的示例：

```powershell
python -B '.agents/skills/ui-ux-pro-max/scripts/search.py' 'error validation form' --domain ux -n 3
python -B '.agents/skills/ui-ux-pro-max/scripts/search.py' 'touch target size' --domain ux -n 3
python -B '.agents/skills/ui-ux-pro-max/scripts/search.py' 'ranking comparison bar' --domain chart -n 3
```

查询中不包含权限码、成员资料、环境凭证等私密信息。采纳的建议须能解释其适用场景；框架示例、图表库和外部字体不能随建议一起引入。

## 4. 来源与版本约束

来源与固定版本以 Skill 目录的 `SOURCE.json` 为依据，保留 `LICENSE`。上游 SKILL、数据和脚本与项目适配规范分开维护，不用浮动 `main` 静默覆盖固定版本。版本更新须可追溯到提交与差异，不能自动改变产品设计值。安装、升级、检索验证及审查记录归开发库，并遵守日期命名规范。
