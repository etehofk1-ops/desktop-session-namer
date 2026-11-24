# session-namer

English · [한국어](README.ko.md)

**A Claude Code mod that renames sessions in the Claude desktop app's sidebar to match what the conversation is about, without any extra model call.**

![The sidebar title changes from "hi" to "Find login 500 error cause" (illustration)](docs/demo-en.gif)

In the Claude desktop app (Code tab), a session's sidebar title often stays stuck on your first message, like "hi". This mod renames it to the topic of the conversation. The animation above is an illustration of how it works, not a screenshot of the real app.

## How it works

- Each time you send a message, the mod reads the current title with the app's own `get_session` tool. That is a tool call, so it costs no model tokens.
- If the title is just your first message, or three characters or shorter, the mod attaches a short hint (about 300 characters in English, about 150 in Korean) to that message.
  - Messages of four characters or fewer, like "hi" or "ok", have no topic, so the hint is skipped for them.
- Claude puts one hidden line, `<!-- session-title: … -->`, at the top of the reply it was going to write anyway. The mod removes that line from the saved reply and renames the session with the app's `set_session_title` tool. A toast tells you the new title.
- There is no extra model call. A typical session costs one short hint plus a title line of about 15 tokens. Sessions whose title is already fine cost nothing.
- After it names a session, the mod checks again every 30 messages whether the conversation has moved on to something else. You can change the interval, or set it to 0 to turn this off.
- Titles follow the language of the conversation, English or Korean (setting `language`).
- The mod stays out of the way when:
  - you have renamed the session yourself (it turns itself off for that session),
  - the session is a scheduled task,
  - the message came from another session rather than from you.

## How it differs from similar tools

Several tools already name sessions automatically. This is how they compare (checked November 2026).

| | This mod | CLI namers ([sorrycc/session-namer](https://github.com/sorrycc/session-namer), [sathwick-p/claude-rename](https://github.com/sathwick-p/claude-rename)) | [Shepherd-Creative gist](https://gist.github.com/Shepherd-Creative/4b723ba2261292a58bcc931aff7c0b3e) |
| --- | --- | --- | --- |
| Where the title shows | Desktop app sidebar | `claude --resume` list | Desktop app sidebar |
| How the title is made | One hidden line in the reply Claude writes anyway | A separate `claude -p` call (Haiku or Sonnet) | Built from the git repo and branch; Claude makes one extra tool call |
| Renames when the topic changes | Yes, checks every 30 messages | sorrycc every 5 turns; claude-rename names once | No, the name stays fixed |

Renaming in the desktop sidebar has been checked in a real desktop session. A title you set yourself is never overwritten.

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

## Commands

| Command | What it does |
| --- | --- |
| `/session-name` | Show the status, the current verdict and recent activity |
| `/session-name now` | Name the session again on your next message |
| `/session-name off` | Turn it off for this session |
| `/session-name on` | Turn it back on (the current title becomes the new baseline) |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `recheckEvery` | 30 | How many messages after naming before it checks the title again. 0 turns rechecking off. |
| `language` | `auto` | Title language. `auto` uses Korean if your message contains Hangul and English otherwise. Set `en` or `ko` to fix it. |

## Limitations

- It has not been checked whether the hidden line flashes on screen while the reply is streaming. It is removed from the saved reply.
- If Claude ignores the hint, the title stays as it is, and the hint is attached again to your next message.
- The mod relies on the desktop app's `ccd_session_mgmt` tools (`get_session`, `set_session_title`). They are undocumented and may change in any app update. If they stop working, the mod turns itself off for that session.

## Tests

```
claude plugin test .
```

## License

MIT
