# 🦀 Clawd Desk Pet

A pixel desk pet for **Claude Code** that lives right above your chat box.
Clawd watches what Claude is doing and reacts: it types on a tiny keyboard when Claude runs a command, puts on glasses to read code, swings a hammer while editing files, and jumps for joy when a task is done.

住在 **Claude Code** 聊天框右上角的像素桌宠。它会跟着 Claude 的动作变化：跑命令时敲小键盘、读代码时戴眼镜、改文件时抡锤子、任务完成时开心蹦跳。

## ✨ Features 功能

- **Desktop pet 桌面桌宠** 🦀：Clawd lives on your desktop and talks in speech bubbles. Drag it anywhere (it remembers the spot), click to pat, double-click to open the hub, right-click for a menu. Same pixel art as in Claude, outfits and pajamas included. Prefer the old spot? Set 桌宠住在哪 → 聊天框上方

- **Clawd hub Clawd 中心** 🫧：a Liquid Glass window outside Claude (`/clawd-hub`) with everything in one place: home, daily quests, pomodoro, shop, wardrobe, badges, gallery, weekly report and settings. Buttons work live; changes sync to every chat
- **Desktop Dynamic Island 桌面灵动岛** ⚫：a black pill at the top of your screen showing Clawd, its mood and the pomodoro countdown. Click to expand it for controls; it pops open on its own when Claude is waiting for you

- **Tool-specific actions 工具专属动作**：Bash ⌨️ / Read 📖 / Edit 🔨 / WebSearch 🔭 / TodoWrite 📋, plus smoke and a red ✗ when a tool fails
- **Raising game 养成系统**：XP, levels and coins are earned **only by actually using Claude Code**（对话、工具调用、改文件、每日打卡）
- **4 growth forms 四个形态**：宝宝期 → 成长期 → 绅士期 → 闪耀期, each with its own idle, action and mood animations
- **Idle skits 发呆小剧场**：stretching, yawning, walking around, plus a special skit for each form
- **Wardrobe & shop 衣柜和商店**：19 accessories, unlocked by achievements or bought with coins
- **15 badges 成就徽章** with an original "achievement" chime 🔔
- **Focus mode 专注模式**：quiet, slower animations, no pop-ups, and a chime when a long task finishes
- **"Waiting for you" nudge 等你回复提醒**：when Claude asks you a question or needs permission, Clawd holds up a ! ? sign and plays a soft ding-dong
- **Daily quests 每日任务**：3 small goals a day (e.g. finish 5 turns, edit 3 files), plus a bonus for clearing all three
- **Pomodoro timer 番茄钟** 🍅：focus 25 min → break 5 min, with a long break every 4 rounds. Clawd wears a tomato while you focus and holds a cup of water on breaks
- **Night mode 夜间模式** 🌙：from 11pm (configurable) Clawd puts on a nightcap and pajamas, slows down, and gently reminds you to sleep. It only does this if you're still working, and never during focus mode or a pomodoro
- **Settings window 设置窗口**：a macOS-style native window (sidebar, toggles, pop-up menus) for sound, size, speed, sleep timer, pomodoro lengths, night mode and more
- **Gallery 图鉴**：preview every form, action, skit and accessory
- **Weekly report helper 周报小助手**：keeps a local daily log and drafts a weekly report (progress / problems / next week)

Everything runs locally. Clawd never calls the model, so it costs **0 tokens**.
全部在本地运行，不调用 AI，**不消耗 token**。

## 📦 Install 安装

At the prompt of a Claude Code **terminal** session:

```
/plugin install desk-pet --marketplace Kho10-16/clawd-desk-pet
```

From a shell:

```
claude plugin install desk-pet --marketplace Kho10-16/clawd-desk-pet
```

In the **Claude desktop app** (where `/plugin` does not run): click **+** next to the prompt box → **Plugins** → **Add marketplace** with `Kho10-16/clawd-desk-pet` → **Add plugin**.

## 🎮 Commands 命令

| Command | What it does |
|---|---|
| `/clawd-hub` | Open the Clawd hub window 打开 Clawd 中心 |
| `/pet` | Open Clawd's panel inside Claude: stats, wardrobe, shop, badges 打开养成面板 |
| `/clawd-settings` | Open the settings window (a native Windows dialog, outside Claude) 弹出设置窗口 |
| `/clawd-dex` | Open the gallery 打开图鉴 |
| `/clawd-week` | Open the weekly report helper 打开周报 |
| `/clawd-focus` | Toggle focus mode 开关专注模式 |
| `/clawd-pomo` | Start / stop the pomodoro timer 开始或停止番茄钟 |

Panel hotkeys: `p` pat · `f` snack · `w` wake · `d` gallery · `r` weekly report · `s` settings window · `t` pomodoro · `h` Clawd hub

Desktop pet: drag to move · click to pat · double-click for the hub · right-click for a menu (snack, pomodoro, put it back above the chat box).

The Dynamic Island starts by itself; turn it off under 专注与打扰 in settings, or right-click it → 隐藏灵动岛.

## 🛠 Customize 自己改

| File | What's inside |
|---|---|
| `hooks/rules.ts` | Numbers & rules: XP, coins, badges, items, skits 养成数值和规则 |
| `hooks/art.ts` | All pixel art and animations 像素美术和动画 |
| `hooks/register.tsx` | Claude Code events and the panels 事件和面板 |
| `hooks/report.ts` | Daily log and weekly report 小账本和周报 |
| `hooks/quests.ts` | Daily quest pool 每日任务池 |
| `tools/settings.ps1` | The Windows settings window 设置窗口 (Windows) |
| `tools/settings-mac.js` | The macOS settings window 设置窗口 (macOS) |
| `tools/hub.ps1` + `tools/hub/index.html` | The Clawd hub: a tiny local server and the Liquid Glass page Clawd 中心 |
| `tools/island.ps1` | The desktop Dynamic Island 桌面灵动岛 |
| `tools/pet.ps1` | The draggable desktop pet 桌面桌宠 |
| `tools/make-sounds.mjs` | Synthesizes the original sound effects — run `node tools/make-sounds.mjs` 合成原创音效 |

## 📝 Notes

- The settings window works on Windows (`tools/settings.ps1`) and macOS (`tools/settings-mac.js`, a native Cocoa window run by the built-in `osascript`). The macOS version is new and has not been tested on a real Mac yet; feedback welcome.
- The Clawd hub, the Dynamic Island and the desktop pet are Windows-only for now; on other systems Clawd stays above the chat box. The hub opens in Microsoft Edge's app mode with its own profile, served only on `127.0.0.1` with a random per-launch token.
- Sounds play through PowerShell on Windows (Claude Code's own audio player is silent there) and through Claude Code elsewhere.
- Clawd's look is inspired by the Claude Code mascot; this is an unofficial fan project, not affiliated with Anthropic.
- The weekly report data stays on your computer. Saved reports go to `reports/`, which is git-ignored.

## License

MIT
