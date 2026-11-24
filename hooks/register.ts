import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NamerAction, NamerEntry, NamerState } from '../types'
import {
  buildHint,
  extractMarker,
  isRefusalResult,
  isScheduledSession,
  isToolError,
  isTrivialMessage,
  judge,
  parseSession,
  recheckEvery,
  sanitizeTitle,
} from './logic'
import type { HintKind, Verdict } from './logic'

const GET = 'mcp__ccd_session_mgmt__get_session'
const SET = 'mcp__ccd_session_mgmt__set_session_title'

const INITIAL: NamerState = {
  off: null,
  lastTitle: null,
  promptsSinceSet: 0,
  forceNext: false,
  lastSeenTitle: null,
  history: [],
}
// 저장 형태가 바뀌면 태그를 올린다(옛 값은 버려진다).
const store = atom({ plugin: 'session-namer', key: 'state' } as const, INITIAL, {
  shape: 'state-v2',
})

type LooseResult = {
  text?: string
  isError?: boolean
  deny?: string
  result?: unknown
}

/** 도구 결과에서 글을 뽑는다(text, 없으면 result 안의 문자열·content). */
function textOf(r: LooseResult): string {
  if (typeof r.text === 'string') return r.text
  const v = r.result
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const c = (v as { content?: unknown }).content
    if (Array.isArray(c)) {
      return c
        .map(b => (b && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
        .join('\n')
    }
    try {
      return JSON.stringify(v)
    } catch {
      return ''
    }
  }
  return ''
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function patch($: EngineInterface, fn: (s: NamerState) => NamerState): Promise<void> {
  await update($, store, fn)
}

function record(s: NamerState, entry: Omit<NamerEntry, 'at'>): NamerState {
  return { ...s, history: [...s.history, { ...entry, at: Date.now() }].slice(-10) }
}

async function log(
  $: EngineInterface,
  action: NamerAction,
  extra: { title?: string; reason?: string } = {},
): Promise<void> {
  await patch($, s => record(s, { action, ...extra }))
}

type Current =
  | { ok: true; title: string }
  | { ok: false; why: 'unavailable' | 'scheduled' | 'no-title'; detail?: string }

/** 지금 사이드바 제목을 읽는다(앱 도구 호출, 모델 토큰 없음). */
async function readCurrentTitle($: EngineInterface): Promise<Current> {
  try {
    const got = (await $.tool.call({ tool: GET, session_id: 'self' })) as LooseResult
    // 본문(JSON)에 '거절' 같은 말이 든 제목이 있어도 끄지 않게, 오류 표시만 본다.
    if (isToolError(got)) return { ok: false, why: 'unavailable' }
    const parsed = parseSession(textOf(got))
    if (isScheduledSession(parsed.data)) return { ok: false, why: 'scheduled' }
    if (parsed.title === null) return { ok: false, why: 'no-title' }
    return { ok: true, title: parsed.title }
  } catch (e) {
    // 데스크톱이 아니면 도구가 없어 reject 된다.
    return { ok: false, why: 'unavailable', detail: errMsg(e).slice(0, 100) }
  }
}

/**
 * 첫 사용자 메시지의 글. 기록에 아직 없으면 null, 읽지 못하면(거절·오류) false.
 * false 일 때는 짧은 이름 규칙만 쓴다.
 */
async function readFirstMessage($: EngineInterface): Promise<string | null | false> {
  try {
    const rows = await $.session.messages()
    if (!Array.isArray(rows)) return false
    for (const m of rows) {
      if (m.role === 'user' && typeof m.text === 'string' && m.text.trim() !== '') return m.text
    }
    return null
  } catch {
    return false
  }
}

function offReason(why: 'unavailable' | 'scheduled' | 'no-title'): string | null {
  return why === 'no-title' ? null : why
}

const VERDICT_LABEL: Record<Verdict, string> = {
  first: '첫 마디 이름',
  short: '너무 짧은 이름',
  stale: '모드가 지은 이름(오래됨)',
  own: '모드가 지은 이름',
  'user-renamed': '사용자가 바꾼 이름',
  none: '해당 없음',
}

/** 표시에서 뽑은 이름을 앱 도구로 적용한다. */
async function applyTitle($: EngineInterface, raw: string, forced: boolean): Promise<void> {
  try {
    const title = sanitizeTitle(raw)
    if (title === null) {
      await log($, 'skip', { reason: 'bad-title' })
      return
    }
    const st = await read($, store)
    if (title === st.lastSeenTitle || title === st.lastTitle) {
      await log($, 'same', { title })
      return
    }
    let setResult: LooseResult
    try {
      setResult = (await $.tool.call({ tool: SET, session_id: 'self', title })) as LooseResult
    } catch (e) {
      const reason = `set-failed: ${errMsg(e)}`.slice(0, 120)
      await patch($, s => ({ ...s, off: 'set-failed' }))
      await log($, 'off', { reason })
      return
    }
    const asText: LooseResult = { ...setResult, text: textOf(setResult) }
    if (isRefusalResult(asText)) {
      await patch($, s => ({ ...s, off: 'set-refused' }))
      await log($, 'off', { reason: `set-refused: ${asText.text ?? ''}`.slice(0, 120) })
      return
    }
    await patch($, s => ({
      ...s,
      lastTitle: title,
      lastSeenTitle: title,
      promptsSinceSet: 0,
      // 사용자가 바꾼 이름 위에 한 번 시킨 경우: 이제 모드가 정한 이름이니 다시 켠다.
      off: forced && s.off === 'user-renamed' ? null : s.off,
    }))
    await log($, 'set', { title })
    $.ui.toast('세션 이름 → ' + title)
  } catch (err) {
    try {
      await log($, 'error', { reason: errMsg(err).slice(0, 120) })
    } catch {
      // 조용히 둔다.
    }
  }
}

export const register: Register = (on, options) => {
  // 이름 오래됨 점검 간격(메시지 수). 0 이면 끈다. 설정 메뉴에서 바꾸면 모듈이 다시 불러와진다.
  const every = recheckEvery(options?.['recheckEvery'])
  // 이번 사용자 메시지에 안내를 붙였는가(그래야 답의 표시를 받아들인다).
  let pendingHint = false
  // 그 안내가 `/session-name now` 의 한 번이었는가.
  let pendingForced = false
  // 첫 사용자 메시지는 한 번 찾으면 바뀌지 않는다.
  let firstMessage: string | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-name',
      description: '세션 이름 자동 짓기 상태 보기 (now · on · off)',
      argumentHint: '[now|on|off]',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 사용자가 친 말에만 붙인다: 슬래시 명령·숨은 메시지는 건너뛴다.
    if (e.command !== undefined || e.isMeta) return next(e)
    pendingHint = false
    pendingForced = false
    try {
      const st0 = await read($, store)
      const forced = st0.forceNext
      if (st0.off !== null && !forced) return next(e)

      await patch($, s => ({ ...s, promptsSinceSet: s.promptsSinceSet + 1, forceNext: false }))
      const cur = await readCurrentTitle($)
      if (!cur.ok) {
        const why = offReason(cur.why)
        if (why !== null) {
          await patch($, s => ({ ...s, off: why }))
          await log($, 'off', { reason: cur.detail ? `${why}: ${cur.detail}` : why })
        }
        return next(e)
      }
      const st = await read($, store)
      await patch($, s => ({ ...s, lastSeenTitle: cur.title }))

      let attach = forced
      let verdict: Verdict | null = null
      if (!forced) {
        // 한 번 찾으면 바뀌지 않는다. 읽기에 실패하면(false) 이번만 짧은 이름 규칙만 쓴다.
        let first: string | null | false = firstMessage
        if (first === null) {
          first = await readFirstMessage($)
          if (typeof first === 'string') firstMessage = first
        }
        // 첫 메시지가 아직 기록에 없으면(이 메시지가 처음) 지금 메시지가 첫 메시지다.
        verdict = judge({
          title: cur.title,
          // 기록에 아직 없으면(이 메시지가 처음) 지금 메시지가 첫 메시지다.
          firstMessage: first === false ? null : (first ?? e.text),
          lastTitle: st.lastTitle,
          promptsSinceSet: st.promptsSinceSet,
          recheckEvery: every,
        })
        if (verdict === 'user-renamed') {
          await patch($, s => ({ ...s, off: 'user-renamed' }))
          await log($, 'off', { reason: 'user-renamed' })
          return next(e)
        }
        attach = verdict === 'first' || verdict === 'short' || verdict === 'stale'
        // "ㅎㅇ"·"ㅇㅋ" 같은 짧은 말에는 주제가 없어 안내가 헛돈다. 다음 메시지로 미룬다.
        if (attach && isTrivialMessage(e.text)) {
          await log($, 'skip', { reason: 'trivial' })
          return next(e)
        }
      }
      if (!attach) return next(e)

      pendingHint = true
      pendingForced = forced
      // 안내만 보고 이름을 안 지어도 다시 점검 간격만큼 뒤에 보게 한다(매번 붙이지 않게).
      if (verdict === 'stale') await patch($, s => ({ ...s, promptsSinceSet: 0 }))
      await log($, 'hint', { title: cur.title, reason: forced ? 'now' : (verdict ?? undefined) })
      const kind: HintKind = forced ? 'now' : verdict === 'stale' ? 'stale' : verdict === 'short' ? 'short' : 'first'
      return next({ ...e, context: [...(e.context ?? []), buildHint(cur.title, kind)] })
    } catch (err) {
      pendingHint = false
      try {
        await log($, 'error', { reason: errMsg(err).slice(0, 120) })
      } catch {
        // 기록도 못 하면 조용히 둔다.
      }
      return next(e)
    }
  })

  on('session.append', async ($, e, next) => {
    const m = e.message
    // 메인 스레드의 assistant 줄만 본다.
    if (e.agentId !== undefined || m.type !== 'assistant' || !Array.isArray(m.content)) return next(e)

    let found: string | null = null
    let changed = false
    const blocks: typeof m.content = []
    for (const b of m.content) {
      if (b && b.type === 'text' && typeof b.text === 'string') {
        const x = extractMarker(b.text)
        if (x.found !== null) {
          changed = true
          if (found === null) found = x.found
          // 글이 비면 다른 블록이 있을 때는 그 블록을 빼고, 하나뿐이면 빈 글로 둔다.
          if (x.text === '' && m.content.length > 1) continue
          blocks.push({ ...b, text: x.text })
          continue
        }
      }
      blocks.push(b)
    }
    if (!changed) return next(e)

    const result = await next({ ...e, message: { ...m, content: blocks } })
    if (found !== null && pendingHint) {
      const raw = found
      const forced = pendingForced
      pendingHint = false
      // 기다리지 않고 뒤에서 한다. 예외는 모두 잡는다.
      void applyTitle($, raw, forced).catch(() => {})
    }
    return result
  })

  on('command.run', { command: 'session-name' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await patch($, s => ({ ...s, off: 'manual', forceNext: false }))
      return { text: '이 세션에서 이름 자동 짓기를 껐습니다.' }
    }
    if (arg === 'on') {
      await patch($, s => ({ ...s, off: null, lastTitle: null, promptsSinceSet: 0 }))
      return { text: '이름 자동 짓기를 다시 켰습니다. 지금 이름을 새 기준으로 삼습니다.' }
    }
    if (arg === 'now') {
      await patch($, s => ({ ...s, forceNext: true }))
      return { text: '다음 메시지에 이름 안내를 한 번 붙입니다.' }
    }
    if (arg !== '') return { text: '쓰는 법: /session-name [now|on|off]' }

    const st = await read($, store)
    let judged = '확인 못 함'
    const cur = await readCurrentTitle($)
    if (cur.ok) {
      let first: string | null | false = firstMessage
      if (first === null) first = await readFirstMessage($)
      const v = judge({
        title: cur.title,
        firstMessage: first === false ? null : first,
        lastTitle: st.lastTitle,
        promptsSinceSet: st.promptsSinceSet,
        recheckEvery: every,
      })
      judged = `${VERDICT_LABEL[v]} («${cur.title}»)`
    } else {
      judged = cur.why === 'scheduled' ? '예약 작업 세션' : cur.why === 'unavailable' ? '이름 도구 없음' : '이름을 읽지 못함'
    }
    const lines = [
      `상태: ${st.off === null ? '켜짐' : `꺼짐 (${st.off})`}${st.forceNext ? ', 다음 메시지에 안내 예약됨' : ''}`,
      `지금 판정: ${judged}`,
      `마지막으로 정한 이름: ${st.lastTitle ?? '없음'}`,
      '최근 기록:',
      ...(st.history.length === 0
        ? ['  아직 없음']
        : st.history
            .slice(-3)
            .reverse()
            .map(h => `  ${h.action}${h.title ? ` ${h.title}` : ''}${h.reason ? ` (${h.reason})` : ''}`)),
    ]
    return { text: lines.join('\n') }
  })
}
