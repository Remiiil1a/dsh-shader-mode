# dsh-shader-mode（着色器模式）

DeepSeek Harness 的**主智能体 / 子智能体预设对**，面向着色器工作。

主智能体只与你交流、规划工作，并把**每一个**任务连同明确的技能指派交给子智能体。
子智能体从不直接对你说话：它的最后一条消息是给主智能体的报告，由主智能体判断这份
报告够不够格。

## 为什么是两个预设

这不是仪式。一个既当主智能体又亲自实现的角色会失去判断力——产出改动的那份上下文
一定会替那份改动辩护。把角色拆开，主智能体的验收才有意义。

拆分由**组合**保证，不靠提示词：

| | `shader-lead` | `shader-worker` |
|---|---|---|
| `shader_dispatch` / `shader_board` / `shader_route` | 有 | **没有** |
| 子智能体常驻指令 | **没有** | 有 |
| 内置着色器模式技能 | 没有 | 有 |
| 与用户交流 | 是 | **否** |

子智能体派发不了任务，因为那个工具不在它的工具表里；主智能体也读不到子智能体的
指令，因为那些指令挂在另一个预设上。

## 安装

```powershell
# 在本包的绝对路径下
plugin_manager install_bundle --target <本目录的绝对路径>
```

然后新建会话，选择 **Shader mode (lead)** 预设。子智能体预设由 `shader_dispatch`
自动选择，你不需要手动挑。

## 工作循环

```
读项目自己的工作流
        ↓
把工作拆成任务
        ↓
派发一个任务  ──→  子智能体加载指派的技能、干活、回报
        ↑                        ↓
        └──── 判断这份报告 ←────┘
                    ↓
        接受 / 返工 / 重新规划
                    ↓
        向用户汇报（只在需要用户决定时）
```

## 工具

### `shader_dispatch`

在 `shader-worker` 预设上启动一个子智能体，立刻返回它的 id。

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 一行标题，显示在任务板上，也出现在子智能体的第一行。 |
| `brief` | 是 | 任务本身，写给一个看不到这段对话的人。 |
| `skills` | 是 | 子智能体必须先加载的技能名。**至少一个。** |
| `acceptance` | 是 | 主智能体将如何判定结果，写成可核对的句子。 |
| `workflow` | 否 | 项目自己的流程，照抄。 |
| `context` | 否 | 子智能体查不到的事实。 |
| `cwd` | 否 | 工作目录，默认当前目录。 |

技能指派是**写进子智能体提示词的指令**，不是提示。没有技能指派的派发会被拒绝：
一个你还没决定"怎么做"的任务，是一个你还没规划完的任务。

### `shader_board`

读任务板：每个任务、它的技能、它的验收、以及回报了什么。写下一个任务之前用它，
免得重新推导；向用户汇报之前也用它，免得把还没完成的工作说成完成了。

任务板是缓存。如果它是空的但确实有子智能体，说明 Host 重启过——去读子会话，不要
当成什么都没派发过。

### `shader_route`

记录任务的下场：`reported`、`accepted`、`rework`、`dropped`。返工轮次会被计数，
所以一个反复回来的任务会以"返工 3 轮"的形式暴露出来。

## 内置技能

本包自带三个技能，挂在子智能体预设上：

| 技能 | 用途 |
|---|---|
| `shader-mode-workflow` | 主智能体的循环：读项目流程、拆任务、派发、判断、汇报。 |
| `shader-mode-dispatch` | 怎么写一份子智能体能执行的简报，含正反例对照。 |
| `shader-mode-report` | 子智能体怎么回报：证据、部分结果、被卡住时怎么办。 |

它们挂在子智能体预设上是刻意的：它们描述的是**子智能体**的行为，主智能体加载它们
等于在读写给别人的指令。

主智能体从会话现有的技能目录里指派技能。装了
[deepseek-stack](https://github.com/aicodeking/deepseek-stack) 就有流程类技能
（`ds-plan-loop`、`ds-verify-loop`、`ds-tdd`、`ds-review-loop`、`ds-unstick`、
`ds-lessons` 等）；装了着色器技能就有领域类技能（`shader-single`、
`shader-single-strict`、`shader-team-architect`、`shader-glsl`）。

## 遵循项目原有的工作流

要求：新项目由主智能体设计工作流；已有项目由主智能体**读取**工作流。

`shader-mode-workflow` 要求主智能体在规划之前先找交接文档、流程文档、贡献指南或
构建脚本，并把项目自己的编号流程抄进每次派发的 `workflow` 字段。跳过项目流程里
某一步的任务，是一个会被退回来的任务。

对还没有工作流的项目，主智能体要先告诉用户并提议一套流程，再开始派发——不会悄悄
发明一套流程，事后当成项目原有的东西端出来。

## 配置

`cordis.patch.yml` 里的 `shader-mode` 行：

| 字段 | 默认 | 含义 |
|---|---|---|
| `workerPreset` | `shader-worker` | 每个派发出去的子智能体所用的预设。 |
| `maxDepth` | `0` | 交给每个子智能体的委派深度。`0` 让子智能体成为叶子，把工作形状的决定权留在主智能体手里。 |

## 测试

```powershell
node tests\shader-mode.test.js
```

14 项离线检查，覆盖 frontmatter 解析、任务板、提示词组装，以及用 mock 上下文跑的
工具主体。

另有四个脚本检查单元测试够不到的部分：

| 脚本 | 证明什么 |
|---|---|
| `scripts\verify-rows.js` | 三行各自导出 `apply`、声明 `inject`、能解析配置。 |
| `scripts\verify-profile-resolution.js <profileDir>` | 每个预设行都能从 profile 的模块作用域解析——那是注册表挂载时用的基准。 |
| `scripts\verify-presets-mount.js` | patch 能按 Loader 的 `!!js` 方言解析，32 个插件行全部可解析，两个预设的 shader-mode 行互不重叠。 |
| `scripts\verify-presets-live.js` | 两个预设**真的挂得上**：主智能体拿到三个工具、没有子智能体指令；子智能体拿到指令与技能、没有工具；一次派发会在子智能体预设上起一个子会话，技能写进了提示词。 |

最后那个才是关键。它抓到了单元测试抓不到的两个缺陷：worker 与 skills 两行漏了
`apply` 导出，以及 manifest 里 `dsh.engines` 放错了位置。

## 目录

```
index.js          主智能体半边：注册三个工具
tools.js          工具主体与子智能体提示词组装
worker.js         子智能体常驻指令（预设作用域）
skills.js         内置技能提供者（预设作用域）
lib/tool.js       工具定义与参数助手，不 import Harness
lib/board.js      按会话的任务板
skills/*/SKILL.md 三个内置技能
cordis.patch.yml  两个预设与 Host 行
```

这里没有任何 `@deepseek-ai/*` 的 import。装在 profile 里的 bundle 解析自己的依赖，
而 Harness 包是可选 peer，可能从 profile 的 `node_modules` 里根本够不到——所以工具
定义直接按注册表要求的形状写，每个 `execute` 自己校验参数。

## 许可

Unlicense——公有领域，与所在仓库一致。
