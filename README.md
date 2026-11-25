# session-namer

English · [한국어](README.ko.md)

**A Claude Code mod that renames sessions in the Claude desktop app's sidebar to match what the conversation is about, so you never have to name a session yourself. Each title costs one small Haiku call, about $0.00002–0.00023.**

![The sidebar title changes from "hi" to "Find login 500 error cause" (illustration)](docs/demo-en.gif)

In the Claude desktop app (Code tab), a session's sidebar title often stays stuck on your first message, like "hi". This mod renames it to the topic of the conversation. The animation above is an illustration of how it works, not a screenshot of the real app.

## How it works

- Each time you send a message, the mod reads the current title with the app's own `get_session` tool. That is a tool call, so it costs no model tokens.
- If the title is just your first message, or three characters or shorter, the mod waits for Claude's reply to finish.
  - Messages of four characters or fewer, like "hi" or "ok", have no topic, so they are skipped.
- When the reply finishes, the mod sends Haiku the first 1,000 characters of your message and the first 800 characters of the reply in one low-effort call, and asks for a title. It renames the session with the app's `set_session_title` tool. A toast tells you the new title.
- Nothing is added to your conversation. Claude never sees a hint and never writes a hidden line.
- Haiku gets only those two excerpts, sent to Anthropic through your session's own login. Nothing goes anywhere else. Before sending, the mod replaces anything in the excerpts and in the current title that looks like a key, a token or an email address with `[redacted]`. It finds common key formats and email addresses by their shape. It is not a full secret scanner, so a password or personal detail in some other form is sent as is. If the title Haiku returns still contains something like that, the mod does not use it.
- After it names a session, the mod asks Haiku again every 30 messages whether the conversation has moved on to something else. Haiku answers KEEP unless the topic changed. You can change the interval, or set it to 0 to turn this off.
- Titles follow the language of the conversation, English or Korean (setting `language`).
- The mod stays out of the way when:
  - you have renamed the session yourself (it turns itself off for that session), even to a short title like "DB" before the mod has named it. The mod reads the title once more right before renaming, so a title you change during a long task is not overwritten when the task ends,
  - the session is a scheduled task,
  - the message came from another session rather than from you.

## What it costs

Measured on November 25, 2026 with Claude Code 2.1.325 (`claude -p`) and Haiku 5.5. The mod's own naming requests were sent through the same call the mod uses (`$.model.complete`). Costs use Haiku 5.5 list prices: $0.10 per million input tokens and $0.50 per million output tokens.

| Case | Input tokens | Output tokens | Cost per call |
| --- | --- | --- | --- |
| First title, short English chat | 183 | 9 | about $0.00002 |
| First title, short Korean chat | 282 | 18 | about $0.00004 |
| Recheck, short Korean chat | 343 | 18 | about $0.00004 |
| First title, long Korean chat (excerpts at their limit) | 2,126 | 21–30 | about $0.00023 |

- A call takes about 0.9 seconds. It runs after the reply has finished, so you never wait for it.
- The excerpts stop at 1,000 and 800 characters, and Haiku's reply is cut off at 1,024 tokens. The most expensive measured call was the $0.00023 above. A reply that ran all the way to the cutoff would bring a long Korean chat's call to about $0.0007. The excerpts are cut by characters, not tokens, so text that takes more tokens per character than Korean, such as a long run of emoji, can cost more. That case was not measured.
- Most sessions need a single call. A 100-message session needs four (one title and three rechecks), which comes to under $0.001 at the measured costs.
- The call goes through your session's own Claude Code login, so no API key is needed. It counts toward the session's cost total like any other request.
- Before 0.5.0, the conversation's own model wrote the title as a hidden line in its reply. At the same list prices that came to about $0.0006 (Sonnet 5.5) to $0.0021 (Fable 5.2) per title, so the Haiku call is roughly 3 to 57 times cheaper.

## How it differs from similar tools

Several tools already name sessions automatically. This is how they compare (checked November 2026).

| | This mod | CLI namers ([sorrycc/session-namer](https://github.com/sorrycc/session-namer), [sathwick-p/claude-rename](https://github.com/sathwick-p/claude-rename)) | [Shepherd-Creative gist](https://gist.github.com/Shepherd-Creative/4b723ba2261292a58bcc931aff7c0b3e) |
| --- | --- | --- | --- |
| Where the title shows | Desktop app sidebar | `claude --resume` list | Desktop app sidebar |
| How the title is made | One Haiku call from inside the session, after the reply | A separate `claude -p` call (Haiku or Sonnet) | Built from the git repo and branch; Claude makes one extra tool call |
| Renames when the topic changes | Yes, checks every 30 messages | sorrycc every 5 turns; claude-rename names once | No, the name stays fixed |

Renaming in the desktop sidebar has been checked in a real desktop session (0.5.0, November 2026). A title you set yourself is never overwritten.

Since Claude Code 2.1.308, a title returned in a hook's `sessionTitle` field is reported to reach the sidebar of local desktop sessions too ([anthropics/claude-code#104473](https://github.com/anthropics/claude-code/issues/104473)). Before that it only changed the terminal side.

## Requirements

- The Claude desktop app's Code tab. Where the app's tools (`ccd_session_mgmt`) are not available, such as the terminal CLI, the mod turns itself off.
- A Claude Code build that runs hooks-module mods. Tested on 2.1.330.

## Install

In the desktop app: click + next to the prompt box, then Plugins → Add marketplace, enter `etehofk1-ops/desktop-session-namer`, then Add plugin.

In a terminal:

```
/plugin install session-namer --marketplace etehofk1-ops/desktop-session-namer
```

## Like it?

Give it a try, and if it saves you some renaming, please [star the repo](https://github.com/etehofk1-ops/desktop-session-namer). It helps other people find the mod.

You don't even have to go click it. Just ask Claude to "star etehofk1-ops/desktop-session-namer on GitHub". If the GitHub CLI (`gh`) is logged in, Claude can do it with this one command:

```
gh api -X PUT user/starred/etehofk1-ops/desktop-session-namer
```

## Commands

You don't need any of these for normal use.

| Command | What it does |
| --- | --- |
| `/session-name` | Show the status, the current verdict, Haiku calls and tokens used in this session, and recent activity |
| `/session-name now` | Name the session again right away from the latest exchange |
| `/session-name off` | Turn it off for this session. A rename still waiting on Haiku, including one from `now`, is dropped |
| `/session-name on` | Turn it back on. The current title becomes the new baseline and is rechecked every 30 messages |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `recheckEvery` | 30 | How many messages after naming before it checks the title again. 0 turns rechecking off. |
| `language` | `auto` | Title language. `auto` uses Korean if your message contains Hangul and English otherwise, Japanese or Chinese messages included. Set `en` or `ko` to fix it. |

## FAQ

### How do I automatically rename sessions in the Claude desktop app?

Install session-namer (see Install above). From then on, a session whose title is still your first message, or three characters or shorter, gets a title that matches the topic when Claude's reply finishes. There is no command to run.

### Does it use extra tokens?

One small Haiku call per title. Measured calls used 183–2,126 input tokens and 9–30 output tokens, about $0.00002–0.00023 each (November 25, 2026; see What it costs). Nothing is added to your conversation, so Claude's own context does not grow.

### Will it overwrite a title I set myself?

No. When it sees a title you changed, it turns itself off for that session. It also reads the title once more right before renaming.

### Does it work in the terminal CLI?

No. It needs the app tools of the desktop app's Code tab, so it turns itself off in the terminal. For titles in the terminal's `claude --resume` list, the CLI tools in the comparison above are a better fit.

### What does Haiku see?

Only the first 1,000 characters of your last message and the first 800 characters of the reply, sent to Anthropic through your session's own login. Text that looks like a key, a token or an email address is replaced with `[redacted]` before sending.

## Limitations

- Haiku sees only the latest exchange: the first 1,000 characters of your last message and the first 800 of the reply. A recheck that lands on a short detour may rename the session after the detour.
- The title changes when the reply finishes, so a long task gets its title when it ends.
- If a reply is stopped or ends in an error, nothing is named on that turn. The mod tries again after your next message.
- If the Haiku call fails three times in a row, the mod turns itself off for that session. `/session-name on` turns it back on.
- The mod relies on the desktop app's `ccd_session_mgmt` tools (`get_session`, `set_session_title`). They are undocumented and may change in any app update. If they stop working, the mod turns itself off for that session.

## Tests

```
claude plugin test .
```

## License

MIT
