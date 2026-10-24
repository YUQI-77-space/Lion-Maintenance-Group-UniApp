# Skill 安装与使用指南

## 1. 本次安装结论

安装 **UI UX Pro Max**，作为本项目的 UI／UX 设计辅助 Skill。项目路径：`.agents/skills/ui-ux-pro-max/`。这是仓库级安装，不是全局安装，也不是小程序运行依赖；Python 搜索脚本仅供设计／开发时使用。

| 项目 | 记录 |
| --- | --- |
| 来源 | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| 固定提交 | [`d14efff8ed1faa4187f004f79926f428c8074ec7`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/d14efff8ed1faa4187f004f79926f428c8074ec7) |
| 上游目录 | `.claude/skills/ui-ux-pro-max`；其中包含完整 SKILL、scripts、data、references |
| 本项目安装目录 | `.agents/skills/ui-ux-pro-max`，符合上游 Codex 平台模板的目录安排 |
| 安装方法 | 系统 `skill-installer` 的 GitHub 安装脚本，指定 `--dest` 与固定 `--ref` |
| 许可证 | MIT；副本见项目 Skill 目录下 `LICENSE` |
| 来源与完整性 | Skill 目录的 `SOURCE.json`，记录上游提交、原始文件路径及哈希 |
| 运行要求 | Python 3，无额外 pip／npm 依赖；日常搜索读取本地 CSV |
| 检索内容 | 产品类型、视觉风格、色板、交互、字体、图表等；没有原生微信小程序专用 stack |

## 2. 为什么选它

2026-10-24 通过 GitHub API 核对热门候选；以下是**仓库** Star 数快照，不能当作单个 Skill 使用量，也不是全网排名证明。

| 候选 | 仓库 Star | 对本项目的判断 |
| --- | --- | --- |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 139,312 | 同时覆盖设计系统、移动触控、表单与图表，可本地检索；选为主 Skill |
| [Impeccable](https://github.com/pbakaus/impeccable) | 85,339 | 强调界面审查与视觉精修；可作后续补充，本轮不叠加安装 |
| [Anthropic skills 中的 frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | 183,219（整个 skills 仓库） | 擅长网页视觉实现，集合热度不能等同该 Skill 热度；对原生小程序的约束需额外适配 |

选择依据是“热门候选中的系统性指导＋本地可用＋不要求引入前端框架”，不是只看 Star。只安装一个主 Skill，减少多个审美指令互相竞争。

## 3. 本项目适配规则

根 `AGENTS.md`、已确认的业务规则和本目录优先于外部 Skill 的推荐。以下是项目约束，使用 Skill 时一并应用：

| 上游常见建议 | 本项目采用方式 |
| --- | --- |
| React／Tailwind／shadcn 等 stack | 不适用；使用原生 WXML／WXSS／JS，不把小程序当网页实现 |
| Google Fonts／英文展示字体组合 | 使用中文系统字体，不引入在线字体 |
| SVG／Web 图标包 | 优先现有图标管理器与已验证图片；新资源先验证微信兼容，保留可用回退 |
| hover、cursor、DOM、浏览器键盘／ARIA 示例 | 转化为可见按下态、微信原生控件及受支持的无障碍属性；不复制 DOM API |
| CSS px、iOS pt、Android dp 的目标尺寸 | 本项目实际点击热区至少 48px；rpx 需按窗口宽度核算 |
| GSAP、复杂转场、玻璃与发光效果 | 使用轻量 WXSS 动效；遵守 01 的时长、层级和安全区 |
| 默认生成营销 Hero／价格／转化模块 | 不采用；以真实报修与成员工作任务组织信息 |
| 自选技术栈与颜色方案 | 不接受 stack 猜测；品牌蓝已由用户的官方标志确认为 `#0369D7`，只能使用 01 中的同源色阶与语义映射，不能用推荐色板覆盖 |
| 自动持久化 `design-system/*/MASTER.md` | 不作为本项目第二套真相源；正式规范统一维护在本目录 |

上游 SKILL 示例使用 `${CLAUDE_PLUGIN_ROOT}`，本项目不能照抄。实际运行使用下面的项目绝对路径，或从仓库根执行 `.agents/skills/ui-ux-pro-max/scripts/search.py`。

## 4. 本次实际使用与筛选

已运行并检查结果：

| 查询 | 结果／取舍 |
| --- | --- |
| `campus maintenance service mobile --design-system` | 返回运营营销页、深色 OLED、英文展示字体等；与产品不符，未作为正式设计基线 |
| `education service minimal --design-system` | 缩窄重试，返回极简、无衬线、清晰层级；采用这些通用原则，拒绝营销页结构与外部字体 |
| `error validation form --domain ux` | 采用字段旁错误、提交反馈和多错误摘要；DOM 示例转化为微信能力 |
| `touch target size --domain ux` | 采用平台单位不可混用的提醒，建立本项目实际像素热区规则 |
| `ranking comparison bar --domain chart` | 采用柱图做比较、提供文字数据；不引入返回结果中的网页图表库 |
| `color accessible pairs --domain ux`（品牌确认后） | 采用对比度和不可只靠颜色的原则；实际色值从用户提供的官方原图提取，以主蓝 `#0369D7` 固化设计 Token，不采用数据库中的其他品牌蓝 |

这说明 Skill 是检索辅助，需要结合代码和用户任务做判断。自动生成方案中的不适用部分未使用 `--persist` 写入项目。正式设计由本目录整理并审查。

## 5. 日常使用

在下一轮对话可直接指定 `$ui-ux-pro-max`；Codex 按官方规则从仓库 `.agents/skills` 发现 Skill。如未出现，重新打开会话或重启应用。官方说明：[Build skills](https://learn.chatgpt.com/docs/build-skills)。

建议任务提示：

> 使用项目中的 ui-ux-pro-max，先阅读 docs/知识库/Design。按其中的视觉、组件和交互规范改造报修流程，保留原生微信小程序技术栈与业务规则。完成加载、失败、返回保留、提交防重和小屏安全区后再交付。

检索示例（本机绝对路径，其他机器使用实际仓库路径）：

```powershell
python -B 'F:\Program\Maintenance Group APP\.agents\skills\ui-ux-pro-max\scripts\search.py' 'error validation form' --domain ux -n 3
python -B 'F:\Program\Maintenance Group APP\.agents\skills\ui-ux-pro-max\scripts\search.py' 'touch target size' --domain ux -n 3
python -B 'F:\Program\Maintenance Group APP\.agents\skills\ui-ux-pro-max\scripts\search.py' 'ranking comparison bar' --domain chart -n 3
```

先读规范，再围绕一个具体问题查询；检查结果的平台、类别和适用范围，不能让一个网页示例推翻全局设计。无原生小程序 stack 时只用通用领域建议，并明确实现需核实微信支持能力。

## 6. 安装复现与维护

本次使用系统安装脚本完成（脚本路径随 Codex 安装位置变化）：

```powershell
python '<skill-installer目录>\scripts\install-skill-from-github.py' --repo nextlevelbuilder/ui-ux-pro-max-skill --ref d14efff8ed1faa4187f004f79926f428c8074ec7 --path .claude/skills/ui-ux-pro-max --dest 'F:\Program\Maintenance Group APP\.agents\skills'
```

已存在同名目录时安装器会停止，不重复覆盖。上游 SKILL、数据与脚本保持原样，项目差异集中于本指南与根 `AGENTS.md`；另补 LICENSE 和 SOURCE 元数据。

升级先核对新提交、许可证、SKILL 和脚本差异，再安装到临时隔离目录，运行本地检索核查；确认不引入平台假设或额外依赖后再替换，并更新哈希与本指南。不把浮动 `main` 静默覆盖到现有版本，也不因为 Skill 更新自动改变产品设计规范。
