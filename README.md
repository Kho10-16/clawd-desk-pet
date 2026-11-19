# 🦀 Clawd Desk Pet

A pixel desk pet for **Claude Code** that lives right above your chat box.
Clawd watches what Claude is doing and reacts: it types on a tiny keyboard when Claude runs a command, puts on glasses to read code, swings a hammer while editing files, and jumps for joy when a task is done.

住在 **Claude Code** 聊天框右上角的像素桌宠。它会跟着 Claude 的动作变化：跑命令时敲小键盘、读代码时戴眼镜、改文件时抡锤子、任务完成时开心蹦跳。

## ✨ Features 功能

- **Tool-specific actions 工具专属动作**：Bash ⌨️ / Read 📖 / Edit 🔨 / WebSearch 🔭 / TodoWrite 📋, plus smoke and a red ✗ when a tool fails
- **Raising game 养成系统**：XP, levels and coins are earned **only by actually using Claude Code**（对话、工具调用、改文件、每日打卡）
- **4 growth forms 四个形态**：宝宝期 → 成长期 → 绅士期 → 闪耀期, each with its own idle, action and mood animations
- **Idle skits 发呆小剧场**：stretching, yawning, walking around, plus a special skit for each form
- **Wardrobe & shop 衣柜和商店**：19 accessories, unlocked by achievements or bought with coins
- **13 badges 成就徽章** with an original "achievement" chime 🔔
- **Focus mode 专注模式**：quiet, slower animations, no pop-ups, and a chime when a long task finishes
- **Settings UI 设置界面**：volume, size, animation speed, sleep timer, and more
- **Gallery 图鉴**：preview every form, action, skit and accessory
- **Weekly report helper 周报小助手**：keeps a local daily log and drafts a weekly report (progress / problems / next week)

Everything runs locally. Clawd never calls the model, so it costs **0 tokens**.
全部在本地运行，不调用 AI，**不消耗 token**。

## 📦 Install 安装

At the prompt of a Claude Code **terminal** session:

```
/plugin install desk-pet --marketplace <owner>/clawd-desk-pet
```

From a shell:

```
claude plugin install desk-pet --marketplace <owner>/clawd-desk-pet
```

In the **Claude desktop app** (where `/plugin` does not run): click **+** next to the prompt box → **Plugins** → **Add marketplace** with `<owner>/clawd-desk-pet` → **Add plugin**.

## 🎮 Commands 命令

| Command | What it does |
|---|---|
| `/pet` | Open Clawd's panel: stats, settings, wardrobe, shop, badges 打开养成面板 |
| `/clawd-dex` | Open the gallery 打开图鉴 |
| `/clawd-week` | Open the weekly report helper 打开周报 |
| `/clawd-focus` | Toggle focus mode 开关专注模式 |

Panel hotkeys: `p` pat · `f` snack · `w` wake · `d` gallery · `r` weekly report · `z` focus · `s` sound

## 🛠 Customize 自己改

| File | What's inside |
|---|---|
| `hooks/rules.ts` | Numbers & rules: XP, coins, badges, items, skits 养成数值和规则 |
| `hooks/art.ts` | All pixel art and animations 像素美术和动画 |
| `hooks/register.tsx` | Claude Code events and the panels 事件和面板 |
| `hooks/report.ts` | Daily log and weekly report 小账本和周报 |
| `tools/make-sounds.mjs` | Synthesizes the original sound effects — run `node tools/make-sounds.mjs` 合成原创音效 |

## 📝 Notes

- Sounds play through PowerShell on Windows (Claude Code's own audio player is silent there) and through Claude Code elsewhere.
- Clawd's look is inspired by the Claude Code mascot; this is an unofficial fan project, not affiliated with Anthropic.
- The weekly report data stays on your computer. Saved reports go to `reports/`, which is git-ignored.

## License

MIT
