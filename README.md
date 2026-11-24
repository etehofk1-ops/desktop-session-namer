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

Several tools already name sessions automatically.

- Most call a second model (Haiku or Sonnet) to come up with the title, and they rename the session in the terminal CLI.
- One handles the desktop sidebar, but it has Claude call a rename tool in the middle of its reply.

This mod is different in three ways:

- It makes no extra model call and no extra tool call. The title comes from a hidden line in the reply Claude writes anyway.
- It renames the title in the desktop app's sidebar, and this has been checked in a real desktop session.
- It renames again when the topic changes, and it never overwrites a title you set yourself.

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

## Tests

```
claude plugin test .
```

## License

MIT
