import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NamerAction, NamerEntry, NamerState, NamerTokens, NamerUsage } from '../types'
import {
  buildNamingRequest,
  checkBeforeSet,
  isAutoTitle,
  isRefusalResult,
  isScheduledSession,
  isToolError,
  isTrivialMessage,
  judge,
  normalizeState,
  parseNamingReply,
  parseSession,
  pickLang,
  recheckEvery,
  renamedBeforeNaming,
  sanitizeTitle,
} from './logic'
import type { Lang, NameKind, Verdict } from './logic'

const GET = 'mcp__ccd_session_mgmt__get_session'
const SET = 'mcp__ccd_session_mgmt__set_session_title'

/** Haiku 호출이 이만큼 연속으로 실패하면 이 세션에서는 끈다. */
const MAX_MODEL_FAILS = 3

const INITIAL: NamerState = {
  off: null,
  lastTitle: null,
  promptsSinceSet: 0,
  forceNext: false,
  lastSeenTitle: null,
  history: [],
  modelFails: 0,
  usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, last: null },
}
// 태그는 0.4.0과 같은 state-v2 로 둔다. 올리면 켜진 세션의 상태(off·lastTitle)가 지워진다.
// 0.5.0에서 더한 칸(modelFails·usage)은 normalizeState 가 빈 값으로 채운다.
const store = atom({ plugin: 'session-namer', key: 'state' } as const, INITIAL, {
  shape: 'state-v2',
})

async function readState($: EngineInterface): Promise<NamerState> {
  return normalizeState(await read($, store), INITIAL)
}

/** prompt.submit 이 예약해 두고 turn.complete 가 꺼내 쓰는 이름 짓기 건. */
type Pending = {
  kind: NameKind
  /** 예약할 때 본 이름. 붙이기 직전에 이 이름에서 사람 손으로 바뀌었는지 본다. */
  currentTitle: string
  userText: string
  forced: boolean
  lang: Lang
  /** 첫 사용자 메시지(모르면 null). 그사이 앱이 첫 마디 이름을 붙였는지 가릴 때 쓴다. */
  firstMessage: string | null
  /** 이 건을 만든 뒤 /session-name off 를 했는가. now 로 시킨 건도 off 하면 버린다. */
  cancelled: () => boolean
}

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
  await update($, store, s => fn(normalizeState(s, INITIAL)))
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

/** 기록에서 마지막 user 글과 마지막 assistant 글. 읽지 못하거나 user 글이 없으면 null. */
async function readLastExchange($: EngineInterface): Promise<{ user: string; answer: string } | null> {
  try {
    const rows = await $.session.messages()
    if (!Array.isArray(rows)) return null
    let user: string | null = null
    let answer = ''
    for (const m of rows) {
      if (typeof m.text !== 'string' || m.text.trim() === '') continue
      // 이 명령 자신의 줄은 대화가 아니다.
      if (m.role === 'user' && !m.text.trim().startsWith('/session-name')) user = m.text
      else if (m.role === 'assistant') answer = m.text
    }
    return user === null ? null : { user, answer }
  } catch {
    return null
  }
}

function offReason(why: 'unavailable' | 'scheduled' | 'no-title'): string | null {
  return why === 'no-title' ? null : why
}

const VERDICT_LABEL: Record<Lang, Record<Verdict, string>> = {
  ko: {
    first: '첫 마디 이름',
    short: '너무 짧은 이름',
    stale: '모드가 지은 이름(오래됨)',
    own: '모드가 지은 이름',
    'user-renamed': '사용자가 바꾼 이름',
    none: '해당 없음',
  },
  en: {
    first: 'first-message title',
    short: 'too-short title',
    stale: 'title set by the mod (getting old)',
    own: 'title set by the mod',
    'user-renamed': 'title changed by the user',
    none: 'not applicable',
  },
}

/** 알림·명령 응답 문구. */
const TEXT = {
  ko: {
    toast: '세션 이름 → ',
    commandDescription: 'Show session auto-naming status (now · on · off) / 세션 이름 자동 짓기 상태 보기',
    off: '이 세션에서 이름 자동 짓기를 껐습니다.',
    on: '이름 자동 짓기를 다시 켰습니다. 지금 이름을 새 기준으로 삼습니다.',
    now: '이름을 새로 짓는 중입니다. 바뀌면 알림이 뜹니다.',
    nowLater: '대화 기록을 읽지 못했습니다. 다음 메시지의 턴이 끝나면 이름을 짓습니다.',
    usage: '쓰는 법: /session-name [now|on|off]',
    unknown: '확인 못 함',
    scheduled: '예약 작업 세션',
    unavailable: '이름 도구 없음',
    unreadable: '이름을 읽지 못함',
    status: '상태: ',
    statusOn: '켜짐',
    statusOff: '꺼짐',
    queued: ', 다음 턴 끝에 이름 짓기 예약됨',
    usageLine: (u: NamerUsage) =>
      `Haiku 호출 ${u.calls}번, 토큰 입력 ${u.input}·출력 ${u.output}·캐시 읽기 ${u.cacheRead}·캐시 쓰기 ${u.cacheWrite}`,
    lastCall: (t: NamerTokens) => `마지막 호출: 입력 ${t.input}·출력 ${t.output}`,
    verdict: '지금 판정: ',
    lastTitle: '마지막으로 정한 이름: ',
    none: '없음',
    recent: '최근 기록:',
    nothingYet: '  아직 없음',
  },
  en: {
    toast: 'Session title → ',
    commandDescription: 'Show session auto-naming status (now · on · off) / 세션 이름 자동 짓기 상태 보기',
    off: 'Automatic session naming is off for this session.',
    on: 'Automatic naming is back on. The current title is the new baseline.',
    now: 'Naming this session now. A toast shows the new title.',
    nowLater: 'Could not read the chat history. The title will be set when the next turn ends.',
    usage: 'Usage: /session-name [now|on|off]',
    unknown: 'unknown',
    scheduled: 'scheduled task session',
    unavailable: 'title tool unavailable',
    unreadable: 'could not read the title',
    status: 'Status: ',
    statusOn: 'on',
    statusOff: 'off',
    queued: ', naming queued for the end of the next turn',
    usageLine: (u: NamerUsage) =>
      `Haiku calls: ${u.calls}, tokens in ${u.input} · out ${u.output} · cache read ${u.cacheRead} · cache write ${u.cacheWrite}`,
    lastCall: (t: NamerTokens) => `Last call: in ${t.input} · out ${t.output}`,
    verdict: 'Current verdict: ',
    lastTitle: 'Last title set: ',
    none: 'none',
    recent: 'Recent history:',
    nothingYet: '  none yet',
  },
} as const

/** Haiku 가 지은 이름을 앱 도구로 적용한다. 붙이기 직전에 꺼짐·지금 이름을 다시 본다. */
async function applyTitle($: EngineInterface, raw: string, p: Pending): Promise<void> {
  const { forced, lang } = p
  try {
    const title = sanitizeTitle(raw)
    if (title === null) {
      await log($, 'skip', { reason: 'bad-title' })
      return
    }
    if (p.cancelled()) {
      await log($, 'skip', { reason: 'turned-off' })
      return
    }
    const st = await readState($)
    // 꺼진 세션이면 붙이지 않는다. 꺼진 뒤에 사람이 now 로 시킨 건만 붙인다(그 뒤 off 는 위 cancelled 가 막는다).
    if (st.off !== null && !forced) {
      await log($, 'skip', { reason: 'turned-off' })
      return
    }
    // 예약한 뒤(긴 작업이면 몇 분 전) 사람이 이름을 바꿨으면 덮어쓰지 않는다.
    const cur = await readCurrentTitle($)
    if (!cur.ok) {
      await log($, 'skip', { reason: 'title-unreadable' })
      return
    }
    const check = checkBeforeSet({
      now: cur.title,
      expected: p.currentTitle,
      lastTitle: st.lastTitle,
      firstMessage: p.firstMessage,
    })
    if (check === 'skip') {
      await log($, 'skip', { reason: 'title-changed' })
      return
    }
    if (check === 'renamed') {
      if (forced) {
        await log($, 'skip', { reason: 'user-renamed' })
      } else {
        await patch($, s => ({ ...s, off: 'user-renamed' }))
        await log($, 'off', { reason: 'user-renamed' })
      }
      return
    }
    if (title === cur.title || title === st.lastTitle) {
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
    $.ui.toast(TEXT[lang].toast + title)
  } catch (err) {
    try {
      await log($, 'error', { reason: errMsg(err).slice(0, 120) })
    } catch {
      // 조용히 둔다.
    }
  }
}

/** Haiku 에게 이름을 받아 적용한다. 기다리지 않고 부르므로 예외는 모두 안에서 잡는다. */
async function nameWithModel($: EngineInterface, p: Pending, answer: string): Promise<void> {
  try {
    const { system, prompt } = buildNamingRequest(p.kind, p.lang, p.currentTitle, p.userText, answer)
    let r: Awaited<ReturnType<EngineInterface['model']['complete']>>
    try {
      r = await $.model.complete({ model: 'haiku', system, prompt, effort: 'low', maxTokens: 1024, timeoutMs: 30000 })
    } catch (e) {
      // 막힌 모델 등 보내지도 못한 요청.
      const reason = `model-unavailable: ${errMsg(e)}`.slice(0, 100)
      await patch($, s => ({ ...s, off: 'model-unavailable' }))
      await log($, 'off', { reason })
      return
    }
    const u = r.usage
    if (u) {
      const t: NamerTokens = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      }
      await patch($, s => ({
        ...s,
        usage: {
          calls: s.usage.calls + 1,
          input: s.usage.input + t.input,
          output: s.usage.output + t.output,
          cacheRead: s.usage.cacheRead + t.cacheRead,
          cacheWrite: s.usage.cacheWrite + t.cacheWrite,
          last: t,
        },
      }))
    }
    if (!r.isAnswered) {
      const reason = `model: ${r.reason}${r.reason === 'api-error' && r.status !== null ? ` ${r.status}` : ''}`
      await patch($, s => ({ ...s, modelFails: s.modelFails + 1 }))
      await log($, 'error', { reason })
      const st = await readState($)
      if (st.modelFails >= MAX_MODEL_FAILS) {
        await patch($, s => ({ ...s, off: 'model-failed' }))
        await log($, 'off', { reason: 'model-failed' })
      }
      return
    }
    await patch($, s => ({ ...s, modelFails: 0 }))
    const parsed = parseNamingReply(r.text)
    if (parsed.kind === 'skip') {
      await log($, 'skip', { reason: 'model-skip' })
    } else if (parsed.kind === 'keep') {
      await log($, 'same', { reason: 'model-keep' })
    } else if (parsed.kind === 'bad') {
      await log($, 'skip', { reason: 'bad-title' })
    } else {
      await applyTitle($, parsed.title, p)
    }
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
  // 이름·알림 언어: 'auto' 면 사용자 메시지에서 읽고, 마지막으로 정한 언어를 기억한다(처음엔 ko).
  const langOption = options?.['language']
  let lang: Lang = pickLang(langOption, null, 'ko')
  // 이번 사용자 메시지로 예약된 이름 짓기 건. 턴이 끝나면(turn.complete) 꺼내 쓴다.
  let pending: Pending | null = null
  // 첫 사용자 메시지는 한 번 찾으면 바뀌지 않는다.
  let firstMessage: string | null = null
  // /session-name off 를 할 때마다 1 올린다. 그 전에 만든 이름 짓기 건(now 포함)은 붙이지 않는다.
  let offCount = 0
  const cancelledAfter = (n: number) => () => offCount !== n

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-name',
      description: TEXT.ko.commandDescription,
      argumentHint: '[now|on|off]',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 사용자가 친 말만 본다: 슬래시 명령·숨은 메시지는 건너뛴다.
    if (e.command !== undefined || e.isMeta) return next(e)
    pending = null
    lang = pickLang(langOption, e.text, lang)
    try {
      const st0 = await readState($)
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
      const st = await readState($)
      await patch($, s => ({ ...s, lastSeenTitle: cur.title }))

      let queue = forced
      let verdict: Verdict | null = null
      let firstKnown: string | null = firstMessage
      if (!forced) {
        // 한 번 찾으면 바뀌지 않는다. 읽기에 실패하면(false) 이번만 짧은 이름 규칙만 쓴다.
        let first: string | null | false = firstMessage
        if (first === null) {
          first = await readFirstMessage($)
          if (typeof first === 'string') firstMessage = first
        }
        // 첫 메시지가 아직 기록에 없으면(이 메시지가 처음) 지금 메시지가 첫 메시지다.
        firstKnown = first === false ? null : (first ?? e.text)
        // 모드가 짓기 전에 사람이 "DB"처럼 짧은 이름으로 바꿨으면, 짧다고 덮어쓰지 않는다.
        if (
          renamedBeforeNaming({
            title: cur.title,
            lastSeenTitle: st.lastSeenTitle,
            lastTitle: st.lastTitle,
            firstMessage: firstKnown,
          })
        ) {
          await patch($, s => ({ ...s, off: 'user-renamed' }))
          await log($, 'off', { reason: 'user-renamed' })
          return next(e)
        }
        verdict = judge({
          title: cur.title,
          firstMessage: firstKnown,
          lastTitle: st.lastTitle,
          promptsSinceSet: st.promptsSinceSet,
          recheckEvery: every,
        })
        if (verdict === 'user-renamed') {
          await patch($, s => ({ ...s, off: 'user-renamed' }))
          await log($, 'off', { reason: 'user-renamed' })
          return next(e)
        }
        queue = verdict === 'first' || verdict === 'short' || verdict === 'stale'
        // "ㅎㅇ"·"ㅇㅋ" 같은 짧은 말에는 주제가 없어 이름 짓기가 헛돈다. 다음 메시지로 미룬다.
        if (queue && isTrivialMessage(e.text)) {
          await log($, 'skip', { reason: 'trivial' })
          return next(e)
        }
      }
      if (!queue) return next(e)

      const kind: NameKind = forced ? 'now' : verdict === 'stale' ? 'stale' : verdict === 'short' ? 'short' : 'first'
      pending = {
        kind,
        currentTitle: cur.title,
        userText: e.text,
        forced,
        lang,
        firstMessage: firstKnown,
        cancelled: cancelledAfter(offCount),
      }
      // 이름을 안 지어도 다시 점검 간격만큼 뒤에 보게 한다(매번 짓지 않게).
      if (verdict === 'stale') await patch($, s => ({ ...s, promptsSinceSet: 0 }))
      await log($, 'queue', { title: cur.title, reason: kind })
      // 0.5.0: 메시지에는 아무것도 붙이지 않는다. 이름은 턴이 끝난 뒤 Haiku 가 짓는다.
      return next(e)
    } catch (err) {
      pending = null
      try {
        await log($, 'error', { reason: errMsg(err).slice(0, 120) })
      } catch {
        // 기록도 못 하면 조용히 둔다.
      }
      return next(e)
    }
  })

  on('turn.complete', async ($, e, next) => {
    // 메인 루프의 턴 끝만 본다. 예약 건이 없으면 손대지 않는다.
    if (e.agentId !== undefined || pending === null) return next(e)
    const result = await next(e)
    const p = pending
    pending = null
    // 답이 나온 턴만 짓는다. 끊기거나 거절·오류면 예약만 비우고 다음 메시지에서 다시 판정한다.
    if (p !== null && e.reason === 'answer') {
      // 기다리지 않고 뒤에서 한다. 예외는 모두 잡는다.
      void nameWithModel($, p, e.answer).catch(() => {})
    }
    return result
  })

  on('command.run', { command: 'session-name' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const t = TEXT[lang]
    if (arg === 'off') {
      // 이번 턴 끝에 지으려고 예약해 둔 것도, 이미 Haiku 를 기다리는 것(now 포함)도 버린다.
      pending = null
      offCount++
      await patch($, s => ({ ...s, off: 'manual', forceNext: false }))
      return { text: t.off }
    }
    if (arg === 'on') {
      // 지금 이름을 새 기준으로 삼는다. 사람이 정한 이름이면 모드가 지은 이름처럼 다룬다:
      // recheckEvery 메시지마다 다시 보고, 사람이 또 바꾸면 다시 꺼진다.
      // 첫 마디·짧은 이름이면 기준을 비워 두어 다음 메시지에서 짓게 한다.
      const cur = await readCurrentTitle($)
      let base: string | null = null
      if (cur.ok) {
        let first: string | null | false = firstMessage
        if (first === null) first = await readFirstMessage($)
        if (isAutoTitle(cur.title, first === false ? null : first) === null) base = cur.title
      }
      await patch($, s => ({
        ...s,
        off: null,
        lastTitle: base,
        lastSeenTitle: cur.ok ? cur.title : s.lastSeenTitle,
        promptsSinceSet: 0,
        // 연속 실패로 꺼졌던 경우 다시 세 번까지 기회를 준다.
        modelFails: 0,
      }))
      return { text: t.on }
    }
    if (arg === 'now') {
      // 다음 메시지를 기다리지 않고 바로 짓는다. 기록을 못 읽으면 다음 턴 끝으로 미룬다.
      const ex = await readLastExchange($)
      const cur = ex === null ? null : await readCurrentTitle($)
      if (ex === null || cur === null || !cur.ok) {
        await patch($, s => ({ ...s, forceNext: true }))
        return { text: t.nowLater }
      }
      const l = pickLang(langOption, ex.user, lang)
      void nameWithModel(
        $,
        {
          kind: 'now',
          currentTitle: cur.title,
          userText: ex.user,
          forced: true,
          lang: l,
          firstMessage,
          cancelled: cancelledAfter(offCount),
        },
        ex.answer,
      ).catch(() => {})
      return { text: t.now }
    }
    if (arg !== '') return { text: t.usage }

    const st = await readState($)
    let judged: string = t.unknown
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
      judged = `${VERDICT_LABEL[lang][v]} («${cur.title}»)`
    } else {
      judged = cur.why === 'scheduled' ? t.scheduled : cur.why === 'unavailable' ? t.unavailable : t.unreadable
    }
    const lines = [
      `${t.status}${st.off === null ? t.statusOn : `${t.statusOff} (${st.off})`}${st.forceNext ? t.queued : ''}`,
      `${t.verdict}${judged}`,
      `${t.lastTitle}${st.lastTitle ?? t.none}`,
      t.usageLine(st.usage),
      ...(st.usage.last ? [t.lastCall(st.usage.last)] : []),
      t.recent,
      ...(st.history.length === 0
        ? [t.nothingYet]
        : st.history
            .slice(-3)
            .reverse()
            .map(h => `  ${h.action}${h.title ? ` ${h.title}` : ''}${h.reason ? ` (${h.reason})` : ''}`)),
    ]
    return { text: lines.join('\n') }
  })
}
