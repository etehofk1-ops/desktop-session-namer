import { expect, test } from 'claude-code/testing'

import {
  buildHint,
  extractMarker,
  isAutoTitle,
  isRefusalResult,
  isScheduledSession,
  isToolError,
  isTrivialMessage,
  judge,
  normTitle,
  parseSession,
  recheckEvery,
  sanitizeTitle,
} from '../hooks/logic'

// ---------- 순수 함수 ----------

test('sanitizeTitle: 따옴표·괄호·제목 머리·마침표를 걷어낸다', async () => {
  expect(sanitizeTitle("  '사진 앨범 공유'  ")).toBe('사진 앨범 공유')
  expect(sanitizeTitle('"사이드바 세션 이름 모드"')).toBe('사이드바 세션 이름 모드')
  expect(sanitizeTitle('「사진 앨범 공유」')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('『사진 앨범 공유』')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('«사진 앨범 공유»')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('`사진 앨범 공유`')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('**사진 앨범 공유**')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('제목: 사진 앨범 공유')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('제목：「사진 앨범 공유」')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('세션 제목: 사진 앨범 공유')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('사진 앨범 공유.')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('사진 앨범 공유。')).toBe('사진 앨범 공유')
  expect(sanitizeTitle('사진   앨범\t공유')).toBe('사진 앨범 공유')
})

test('sanitizeTitle: 여러 줄이면 첫 번째 비지 않은 줄', async () => {
  expect(sanitizeTitle('\n\n  사진 앨범 공유  \n설명입니다\n')).toBe('사진 앨범 공유')
})

test('sanitizeTitle: 너무 짧거나 길거나 비면 버린다', async () => {
  expect(sanitizeTitle('가')).toBeNull()
  expect(sanitizeTitle('"가".')).toBeNull()
  expect(sanitizeTitle('')).toBeNull()
  expect(sanitizeTitle('   \n  ')).toBeNull()
  expect(sanitizeTitle('가'.repeat(41))).toBeNull()
  expect(sanitizeTitle('가'.repeat(40))).toBe('가'.repeat(40))
  expect(sanitizeTitle('가나')).toBe('가나')
})

test('sanitizeTitle: 끝 괄호는 남긴다', async () => {
  expect(sanitizeTitle('판매 페이지 (2차)')).toBe('판매 페이지 (2차)')
  expect(sanitizeTitle('"판매 페이지 (2차)".')).toBe('판매 페이지 (2차)')
})

test('isRefusalResult: 오류·거절 말·deny 를 거절로 본다', async () => {
  expect(isRefusalResult({ isError: true })).toBe(true)
  expect(isRefusalResult({ deny: 'no' })).toBe(true)
  expect(isRefusalResult({ text: 'User declined to rename' })).toBe(true)
  expect(isRefusalResult({ text: 'Permission denied' })).toBe(true)
  expect(isRefusalResult({ text: '사용자가 거절했습니다' })).toBe(true)
  expect(isRefusalResult({ text: 'ok' })).toBe(false)
  expect(isRefusalResult({ text: '{"ok":true}', isError: false })).toBe(false)
  expect(isRefusalResult(undefined)).toBe(true)
})

test('isToolError: 본문 글은 보지 않는다(제목에 거절이 들어 있어도 오류 아님)', async () => {
  expect(isToolError({ isError: true })).toBe(true)
  expect(isToolError({ deny: 'no' })).toBe(true)
  expect(isToolError(undefined)).toBe(true)
  expect(isToolError({ text: '{"title":"거절 메일 정리"}' } as any)).toBe(false)
})

test('isScheduledSession: schedul 키가 있고 값이 비어 있지 않을 때만', async () => {
  const plain = parseSession('{"sessionId":"local_1","title":"ᄒᄋ","cwd":"D:\\\\"}')
  expect(plain.title).toBe('ᄒᄋ')
  expect(isScheduledSession(plain.data)).toBe(false)
  expect(isScheduledSession({ title: 'x', scheduledTaskId: 'abc' })).toBe(true)
  expect(isScheduledSession({ title: 'x', schedule: { id: 1 } })).toBe(true)
  expect(isScheduledSession({ title: 'x', scheduledTaskId: null })).toBe(false)
  expect(isScheduledSession({ title: 'x', scheduledTaskId: '' })).toBe(false)
  expect(isScheduledSession({ title: 'x', scheduleRun: [] })).toBe(false)
  expect(isScheduledSession(null)).toBe(false)
})

test('parseSession: JSON 이 아니어도 죽지 않는다', async () => {
  expect(parseSession('not json')).toEqual({ title: null, data: null })
  expect(parseSession('[1,2]')).toEqual({ title: null, data: null })
})

test('normTitle: 호환 자모 "ㅎㅇ" 와 첫가끝 자모 "ᄒᄋ" 가 같다(NFKC 로 충분)', async () => {
  expect('ㅎㅇ'.normalize('NFKC')).toBe('ᄒᄋ'.normalize('NFKC'))
  expect(normTitle('ㅎㅇ')).toBe(normTitle('ᄒᄋ'))
  expect(normTitle(' ㅎ ㅇ\n')).toBe(normTitle('ᄒᄋ'))
  expect(normTitle('ＡＢ c')).toBe('ABc')
})

test('isAutoTitle: 첫 마디·자름·짧음·그 밖', async () => {
  // 첫 마디 이름(호환 자모 vs 첫가끝 자모)
  expect(isAutoTitle('ᄒᄋ', 'ㅎㅇ')).toBe('first')
  expect(isAutoTitle('ㅎㅇ', 'ᄒᄋ')).toBe('first')
  // 공백·전각 차이
  expect(isAutoTitle('판매  페이지 만들어줘', '판매 페이지 만들어줘')).toBe('first')
  // 앱이 긴 첫 메시지를 잘라 이름으로 쓴 경우
  const long = '사진 앨범 공유 페이지를 만들어 줘. 날짜별로 묶어서 보여 줘'
  expect(isAutoTitle('사진 앨범 공유 페이지를 만들어 줘. 날짜별로', long)).toBe('first')
  // 첫 메시지를 모르거나 안 맞는 긴 이름은 건드리지 않는다
  expect(isAutoTitle('린트 규칙 정리', long)).toBeNull()
  expect(isAutoTitle('린트 규칙 정리', null)).toBeNull()
  // 짧은 이름(공백 뺀 3자 이하)
  expect(isAutoTitle('가 나 다', null)).toBe('short')
  expect(isAutoTitle('ᄒᄋ', null)).toBe('short')
  expect(isAutoTitle('네 글자임', null)).toBeNull()
  expect(isAutoTitle('   ', long)).toBe('short')
})

test('judge: 모드 이름·사용자 변경·오래됨', async () => {
  const base = { firstMessage: 'ㅎㅇ', lastTitle: null as string | null, promptsSinceSet: 0 }
  expect(judge({ ...base, title: 'ᄒᄋ' })).toBe('first')
  expect(judge({ ...base, title: '사진 앨범 공유', firstMessage: '다른 말' })).toBe('none')
  expect(judge({ ...base, title: '사진 앨범 공유', lastTitle: '사진 앨범 공유', promptsSinceSet: 14 })).toBe('own')
  expect(judge({ ...base, title: '사진 앨범 공유', lastTitle: '사진 앨범 공유', promptsSinceSet: 15 })).toBe('stale')
  expect(judge({ ...base, title: '내가 바꿈', lastTitle: '사진 앨범 공유' })).toBe('user-renamed')
})

test('judge: recheckEvery 0 은 오래됨 점검을 안 하고, 30 은 30개째에 stale', async () => {
  const own = { firstMessage: 'ㅎㅇ', title: '사진 앨범 공유', lastTitle: '사진 앨범 공유' }
  expect(judge({ ...own, promptsSinceSet: 100, recheckEvery: 0 })).toBe('own')
  expect(judge({ ...own, promptsSinceSet: 29, recheckEvery: 30 })).toBe('own')
  expect(judge({ ...own, promptsSinceSet: 30, recheckEvery: 30 })).toBe('stale')
  // 15 는 이제 기본이 아니다(간격을 주면 그 값을 쓴다).
  expect(judge({ ...own, promptsSinceSet: 15, recheckEvery: 30 })).toBe('own')
})

test('isTrivialMessage: 공백·호환 자모를 정규화해 4자 이하만 짧은 말', async () => {
  expect(isTrivialMessage('ㅎㅇ')).toBe(true)
  expect(isTrivialMessage('  ㅇ ㅋ ')).toBe(true)
  expect(isTrivialMessage('ㅎㅇㅎㅇ')).toBe(true)
  expect(isTrivialMessage('안녕하세요')).toBe(false)
  expect(isTrivialMessage('사진 앨범 공유')).toBe(false)
  expect(isTrivialMessage(undefined)).toBe(true)
})

test('recheckEvery: 이상한 값은 30, 음수는 0, 소수는 내림', async () => {
  expect(recheckEvery(undefined)).toBe(30)
  expect(recheckEvery('10')).toBe(30)
  expect(recheckEvery(NaN)).toBe(30)
  expect(recheckEvery(Infinity)).toBe(30)
  expect(recheckEvery(-5)).toBe(0)
  expect(recheckEvery(7.9)).toBe(7)
  expect(recheckEvery(0)).toBe(0)
  expect(recheckEvery(30)).toBe(30)
})

test('extractMarker: 찾기·지우기·없음·여러 줄', async () => {
  const a = extractMarker('<!-- session-title: 사진 앨범 공유 -->\n안녕하세요')
  expect(a.found).toBe('사진 앨범 공유')
  expect(a.text).toBe('안녕하세요')
  const b = extractMarker('<!--session-title:   이름이 공백 많음   -->\r\n본문\n둘째 줄')
  expect(b.found).toBe('이름이 공백 많음')
  expect(b.text).toBe('본문\n둘째 줄')
  const c = extractMarker('표시 없는 글\n<!-- 다른 주석 -->')
  expect(c.found).toBeNull()
  expect(c.text).toBe('표시 없는 글\n<!-- 다른 주석 -->')
  const d = extractMarker('앞 말 <!-- session-title: 가운데 표시 --> 뒤 말')
  expect(d.found).toBe('가운데 표시')
  expect(d.text).toBe('앞 말  뒤 말')
  const e = extractMarker('<!-- session-title: 첫째 -->\n<!-- session-title: 둘째 -->\n끝')
  expect(e.found).toBe('첫째')
  expect(e.text).toBe('끝')
  expect(extractMarker('<!-- session-title: 혼자 -->').text).toBe('')
})

test('buildHint: 지금 이름과 표시 형식이 들어 있다', async () => {
  const h = buildHint('ᄒᄋ')
  expect(h).toContain('«ᄒᄋ»')
  expect(h).toContain('<!-- session-title:')
  expect(h.includes('새 이름')).toBe(false)
})

test('buildHint: 첫 마디·짧은 이름에는 질문·거절 대화도 반드시 넣으라고 한다', async () => {
  for (const kind of ['first', 'short'] as const) {
    const h = buildHint('ᄒᄋ', kind)
    expect(h).toContain('«ᄒᄋ»')
    expect(h).toContain('<!-- session-title:')
    expect(h).toContain('반드시')
    expect(h).toContain('거절한 요청')
    // 옛 문구("작업이 아직 드러나지 않았거나")는 질문 대화에서 이름을 안 짓게 만들었다.
    expect(h.includes('작업이 아직 드러나지')).toBe(false)
  }
})

test('buildHint: 오래된 이름은 넘어갔을 때만, now 는 반드시', async () => {
  const s = buildHint('사진 앨범 화면 수정', 'stale')
  expect(s).toContain('«사진 앨범 화면 수정»')
  expect(s).toContain('<!-- session-title:')
  expect(s).toContain('넘어갔을 때만')
  expect(s.includes('반드시')).toBe(false)
  expect(s.includes('작업이 아직 드러나지')).toBe(false)
  const n = buildHint('ᄒᄋ', 'now')
  expect(n).toContain('«ᄒᄋ»')
  expect(n).toContain('<!-- session-title:')
  expect(n).toContain('반드시')
  expect(n.includes('작업이 아직 드러나지')).toBe(false)
})

test('buildHint: 어느 종류든 170자 이하(토큰 절약을 못 박는다)', async () => {
  for (const kind of ['first', 'short', 'stale', 'now'] as const) {
    expect(buildHint('사진 앨범 화면 수정', kind).length).toBeLessThanOrEqual(170)
  }
})

// ---------- 통합: 앱 도구를 가짜로 세운다 ----------

const GET = 'mcp__ccd_session_mgmt__get_session'
const SET = 'mcp__ccd_session_mgmt__set_session_title'

type Rig = { sets: string[]; gets: number; models: number; rows: any[] }

type RigOpts = {
  title: () => string
  /** 이 세션의 사용자 메시지(기록에 이미 있는 것). */
  history?: string[]
  extra?: Record<string, unknown>
  setText?: string
  setError?: boolean
  getError?: boolean
  messagesDeny?: boolean
}

async function rig($: any, on: any, opts: RigOpts): Promise<Rig> {
  const r: Rig = { sets: [], gets: 0, models: 0, rows: [] }
  on('command.register', () => ({ value: { command: 'session-name' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text, context: e.context }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.messages', () => {
    if (opts.messagesDeny) return { value: { deny: 'no rows' } }
    return { value: (opts.history ?? []).map(t => ({ role: 'user', text: t, toolUses: [] })) }
  })
  on('model.fork', () => {
    r.models++
    return { value: { isAnswered: false, reason: 'x' } }
  })
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === GET) {
      r.gets++
      if (opts.getError) return { result: {}, text: 'unavailable', isError: true }
      const body = JSON.stringify({ sessionId: 'local_1', title: opts.title(), cwd: 'D:\\', ...(opts.extra ?? {}) })
      return { result: {}, text: body }
    }
    if (e.tool === SET) {
      r.sets.push(e.title)
      if (opts.setError) return { result: {}, text: 'error', isError: true }
      return { result: {}, text: opts.setText ?? 'ok' }
    }
    return { result: {} }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return r
}

async function settle(): Promise<void> {
  for (let i = 0; i < 400; i++) await Promise.resolve()
}

/** 사용자 메시지를 보내고, 모델이 받은 context 를 돌려준다. */
async function say($: any, text: string, extra: Record<string, unknown> = {}): Promise<readonly string[]> {
  const out = await $.prompt.submit({ text, ...extra })
  await settle()
  return out.context ?? []
}

/** 모델의 assistant 줄(글 블록 하나)을 저장시키고, 저장된 글을 돌려준다. */
async function answer($: any, text: string, extra: Record<string, unknown> = {}): Promise<any> {
  const out = await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'u' + Math.random().toString(36).slice(2),
    ...extra,
  })
  await settle()
  return out
}

async function cmd($: any, args: string): Promise<string> {
  const out = await $.command.run({ command: 'session-name', args })
  return out.text ?? ''
}

const HINT_MARK = '[session-namer]'
const hinted = (ctx: readonly string[]) => ctx.some(c => c.includes(HINT_MARK))

test('제목 "ᄒᄋ" + 첫 메시지 "ㅎㅇ" → 다음 메시지에 안내가 붙는다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  const ctx = await say($, '사진 앨범 공유 페이지 만들자')
  expect(hinted(ctx)).toBe(true)
  expect(ctx.join('\n')).toContain('«ᄒᄋ»')
  expect(r.gets).toBe(1)
  expect(r.models).toBe(0)
})

test('첫 메시지가 기록에 아직 없으면 지금 메시지를 첫 메시지로 본다', async ($, on) => {
  await rig($, on, { title: () => '사진 앨범', history: [] })
  expect(hinted(await say($, '사진 앨범 공유 페이지 만들자'))).toBe(true)
})

test('짧은 메시지("ㅇㅋ")에는 첫 마디 이름이어도 안내를 안 붙이고, get_session 은 한 번 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  expect(hinted(await say($, 'ㅇㅋ'))).toBe(false)
  expect(r.gets).toBe(1)
  expect(await cmd($, '')).toContain('skip (trivial)')
})

test('짧은 메시지 다음의 긴 메시지에만 안내가 붙는다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  expect(hinted(await say($, 'ㅎㅇ'))).toBe(false)
  expect(hinted(await say($, '사진 앨범 공유 페이지 만들자'))).toBe(true)
  expect(r.gets).toBe(2)
})

test('/session-name now 는 짧은 메시지에도 안내를 붙인다', async ($, on) => {
  await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await cmd($, 'now')
  expect(hinted(await say($, 'ㅇㅋ'))).toBe(true)
})

test('메시지 기록을 못 읽으면 짧은 이름 규칙만 쓴다(짧으면 붙음)', async ($, on) => {
  await rig($, on, { title: () => '뭐지', messagesDeny: true })
  expect(hinted(await say($, '아주 긴 지시문이 이어집니다'))).toBe(true)
})

test('메시지 기록을 못 읽고 이름이 길면 안내를 안 붙인다', async ($, on) => {
  await rig($, on, { title: () => '긴 이름이지만 첫 마디', messagesDeny: true })
  expect(hinted(await say($, '긴 이름이지만 첫 마디'))).toBe(false)
})

test('제목 "린트 규칙 정리" + 긴 첫 지시문 → 안내가 안 붙는다', async ($, on) => {
  const r = await rig($, on, {
    title: () => '린트 규칙 정리',
    history: ['이 폴더의 린트 규칙을 정리하고 시험까지 돌려 줘. 끝나면 보고해'],
  })
  expect(hinted(await say($, '계속해서 시험까지 돌려 줘'))).toBe(false)
  expect(r.gets).toBe(1)
})

test('앱이 첫 메시지를 잘라 이름으로 쓴 경우에도 안내가 붙는다', async ($, on) => {
  const first = '사진 앨범 공유 페이지를 만들어 줘. 날짜별로 묶어서 보여 줘'
  await rig($, on, { title: () => '사진 앨범 공유 페이지를 만들어 줘. 날짜별로', history: [first] })
  expect(hinted(await say($, '계속해서 결제 화면도 만들어 줘'))).toBe(true)
})

test('assistant 줄의 표시 → 저장 글에서 지워지고 set 이 새 이름으로 불린다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  expect(hinted(await say($, '앨범 공유 페이지 만들자'))).toBe(true)
  const out = await answer($, '<!-- session-title: "사진 앨범 공유 페이지." -->\n네, 시작하겠습니다.')
  expect(out.message.content.map((b: any) => b.text)).toEqual(['네, 시작하겠습니다.'])
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  const status = await cmd($, '')
  expect(status).toContain('켜짐')
  expect(status).toContain('사진 앨범 공유 페이지')
  expect(r.models).toBe(0)
})

test('표시가 없는 줄은 그대로, 글이 아닌 블록은 건드리지 않는다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  const plain =await answer($, '그냥 답입니다')
  expect(plain.message.content.map((b: any) => b.text)).toEqual(['그냥 답입니다'])
  const tool = { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }
  const mixed = await $.session.append({
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'text', text: '<!-- session-title: 앨범 공유 페이지 제작 -->' }, tool],
    },
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'mixed1',
  })
  await settle()
  expect(mixed.message!.content).toEqual([tool])
  expect(r.sets).toEqual(['앨범 공유 페이지 제작'])
})

test('서브에이전트 줄·user 줄의 표시는 이름을 바꾸지 않는다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: 서브에이전트가 쓴 이름 -->\n본문', { agentId: 'a1' })
  expect(r.sets).toEqual([])
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<!-- session-title: 사용자 줄 이름 -->' }] },
    door: 'prompt',
    origin: { kind: 'composer' } as any,
    uuid: 'user1',
  })
  await settle()
  expect(r.sets).toEqual([])
})

test('안내를 붙이지 않은 턴의 표시는 지우기만 하고 이름은 안 바꾼다', async ($, on) => {
  const r = await rig($, on, {
    title: () => '린트 규칙 정리',
    history: ['이 폴더의 린트 규칙을 정리하고 시험까지 돌려 줘. 끝나면 보고해'],
  })
  await say($, '계속해서 시험까지 돌려 줘')
  const out = await answer($, '<!-- session-title: 멋대로 지은 이름 -->\n본문')
  expect(out.message.content.map((b: any) => b.text)).toEqual(['본문'])
  expect(r.sets).toEqual([])
})

test('이름이 지금 이름과 같거나 쓸 수 없으면 set 을 안 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: ᄒᄋ -->\n본문')
  expect(r.sets).toEqual([])
  await say($, '다시 한번 해 보자')
  await answer($, '<!-- session-title: 가 -->\n본문')
  expect(r.sets).toEqual([])
})

test('lastTitle 과 다른 지금 이름 → user-renamed, 안내 안 붙음', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: 사진 앨범 공유 페이지 -->\n본문')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  title = '내가 정한 이름'
  expect(hinted(await say($, '다음 일'))).toBe(false)
  expect(await cmd($, '')).toContain('user-renamed')
  // 이미 꺼졌으니 다시 읽지도 않는다.
  const before = r.gets
  expect(hinted(await say($, '또 다음 일'))).toBe(false)
  expect(r.gets).toBe(before)
})

test('예약 작업 세션 → 아무것도 안 한다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], extra: { scheduledTaskId: 'task-1' } })
  expect(hinted(await say($, '앨범 공유 페이지 시작하자'))).toBe(false)
  expect(r.sets).toEqual([])
  expect(await cmd($, '')).toContain('scheduled')
})

test('도구가 없으면(unavailable) 이 세션에서는 끈다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], getError: true })
  expect(hinted(await say($, '앨범 공유 페이지 시작하자'))).toBe(false)
  expect(await cmd($, '')).toContain('unavailable')
  const before = r.gets
  await say($, '또 다른 일을 해 보자')
  expect(r.gets).toBe(before)
})

test('/session-name now → 다음 메시지에 한 번 붙는다', async ($, on) => {
  const r = await rig($, on, {
    title: () => '린트 규칙 정리',
    history: ['이 폴더의 린트 규칙을 정리하고 시험까지 돌려 줘. 끝나면 보고해'],
  })
  expect(hinted(await say($, '계속해서 시험까지 돌려 줘'))).toBe(false)
  expect(await cmd($, 'now')).toContain('한 번')
  expect(hinted(await say($, '이제 다른 일'))).toBe(true)
  expect(hinted(await say($, '그다음'))).toBe(false)
  await answer($, 'x')
  expect(r.models).toBe(0)
})

test('now 는 꺼진 세션·user-renamed 여도 한 번 붙고, 새 이름을 받으면 다시 켠다', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: 사진 앨범 공유 페이지 -->\n본문')
  title = '내가 정한 이름'
  await say($, '다음 일을 해 보자')
  expect(await cmd($, '')).toContain('user-renamed')
  await cmd($, 'now')
  expect(hinted(await say($, '한 번만 봐줘'))).toBe(true)
  await answer($, '<!-- session-title: 앨범 공유 페이지 개선 -->\n본문')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지', '앨범 공유 페이지 개선'])
  expect((await cmd($, '')).split('\n')[0]).toContain('켜짐')
})

test('슬래시 명령·isMeta 메시지엔 안 붙고 도구도 안 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  expect(hinted(await say($, '/compact', { command: { name: 'compact', args: '' } }))).toBe(false)
  expect(hinted(await say($, '시스템이 보낸 알림', { isMeta: true }))).toBe(false)
  expect(r.gets).toBe(0)
  // 같은 세션의 평범한 메시지에는 붙는다.
  expect(hinted(await say($, '진짜 말 시작해 보자'))).toBe(true)
})

test('모드가 지은 이름: 29개째까지는 조용하고 30개째에 안내(기본 30)', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: 사진 앨범 공유 페이지 -->\n본문')
  title = '사진 앨범 공유 페이지' // 앱이 바꾼 이름이 보이게 된다
  for (let i = 0; i < 29; i++) expect(hinted(await say($, `일 ${i}번째 작업 진행`))).toBe(false)
  expect(hinted(await say($, '서른째 작업 진행해 보자'))).toBe(true)
  // 안내 뒤에는 카운터가 0 으로 돌아가 바로 또 붙지 않는다.
  expect(hinted(await say($, '그다음 작업 진행해 보자'))).toBe(false)
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
})

test('recheckEvery 0: 40개가 지나도 오래됨 안내가 없다', { options: { recheckEvery: 0 } }, async ($, on) => {
  let title = 'ᄒᄋ'
  await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: 사진 앨범 공유 페이지 -->\n본문')
  title = '사진 앨범 공유 페이지'
  for (let i = 0; i < 40; i++) expect(hinted(await say($, `일 ${i}번째 작업 진행`))).toBe(false)
})

test('recheckEvery 5: 5개째에 오래됨 안내', { options: { recheckEvery: 5 } }, async ($, on) => {
  let title = 'ᄒᄋ'
  await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: 사진 앨범 공유 페이지 -->\n본문')
  title = '사진 앨범 공유 페이지'
  for (let i = 0; i < 4; i++) expect(hinted(await say($, `일 ${i}번째 작업 진행`))).toBe(false)
  expect(hinted(await say($, '다섯째 작업 진행해 보자'))).toBe(true)
})

test('/session-name off 뒤에는 안내도 도구 호출도 없다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  expect(await cmd($, 'off')).toContain('껐')
  expect(hinted(await say($, '앨범 공유 페이지 시작하자'))).toBe(false)
  expect(r.gets).toBe(0)
  expect(await cmd($, 'on')).toContain('켰')
  expect(hinted(await say($, '다시 앨범 공유 페이지 시작하자'))).toBe(true)
})

test('앱이 거절하면 이 세션에서는 끈다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], setText: 'User declined the title change' })
  await say($, '앨범 공유 페이지 시작하자')
  await answer($, '<!-- session-title: 사진 앨범 공유 페이지 -->\n본문')
  expect(r.sets.length).toBe(1)
  expect(await cmd($, '')).toContain('set-refused')
})

test('제목에 "거절"이 들어 있어도 끄지 않는다', async ($, on) => {
  const r = await rig($, on, { title: () => '거절', history: ['거절'] })
  expect(hinted(await say($, '메일 답장 정리하자'))).toBe(true)
  await answer($, '<!-- session-title: 거절 메일 답장 정리 -->\n본문')
  expect(r.sets).toEqual(['거절 메일 답장 정리'])
})

test('상태: 지금 판정과 최근 기록을 보여 준다', async ($, on) => {
  await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  const s = await cmd($, '')
  expect(s).toContain('상태: 켜짐')
  expect(s).toContain('첫 마디 이름')
  expect(s).toContain('마지막으로 정한 이름: 없음')
  expect(await cmd($, 'zzz')).toContain('쓰는 법')
})
