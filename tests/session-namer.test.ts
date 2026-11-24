import { expect, test } from 'claude-code/testing'

import {
  ANSWER_EXCERPT,
  USER_EXCERPT,
  buildNamingRequest,
  checkBeforeSet,
  excerpt,
  hasHangul,
  isAutoTitle,
  looksSensitive,
  isRefusalResult,
  isScheduledSession,
  isToolError,
  isTrivialMessage,
  judge,
  maskSensitive,
  normTitle,
  normalizeState,
  parseNamingReply,
  parseSession,
  pickLang,
  recheckEvery,
  renamedBeforeNaming,
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
  expect(sanitizeTitle('가'.repeat(61))).toBeNull()
  expect(sanitizeTitle('가'.repeat(60))).toBe('가'.repeat(60))
  expect(sanitizeTitle('가나')).toBe('가나')
})

test('sanitizeTitle: 영어 제목은 41~60자까지 허용하고 61자는 버린다', async () => {
  const long = 'Migrate the legacy billing service to the new payments API'
  expect([...long].length).toBeGreaterThan(40)
  expect(sanitizeTitle(long)).toBe(long)
  expect(sanitizeTitle('a'.repeat(41))).toBe('a'.repeat(41))
  expect(sanitizeTitle('a'.repeat(60))).toBe('a'.repeat(60))
  expect(sanitizeTitle('a'.repeat(61))).toBeNull()
})

test('hasHangul: 음절·호환 자모·첫가끝 자모 중 하나라도 있으면 true', async () => {
  expect(hasHangul('안녕')).toBe(true)
  expect(hasHangul('ㅎㅇ')).toBe(true)
  expect(hasHangul('ᄒᄋ')).toBe(true)
  expect(hasHangul('fix the 버그 please')).toBe(true)
  expect(hasHangul('Hello, world 123')).toBe(false)
  expect(hasHangul('日本語')).toBe(false)
  expect(hasHangul('')).toBe(false)
  expect(hasHangul(undefined)).toBe(false)
})

test('pickLang: 한글이 없고 글자가 있으면(일본어·중국어·키릴 포함) en', async () => {
  expect(pickLang('auto', '日本語のバグを直して', 'ko')).toBe('en')
  expect(pickLang('auto', '修复登录错误', 'ko')).toBe('en')
  expect(pickLang('auto', 'Исправить ошибку входа', 'ko')).toBe('en')
  expect(pickLang('auto', '日本語と한국어', 'en')).toBe('ko')
})

test('pickLang: ko·en 은 그대로, auto 는 한글 → ko, 라틴 → en, 아니면 fallback', async () => {
  expect(pickLang('ko', 'Hello there', 'en')).toBe('ko')
  expect(pickLang('en', '안녕하세요', 'ko')).toBe('en')
  expect(pickLang('auto', '안녕하세요', 'en')).toBe('ko')
  expect(pickLang('auto', 'Fix the login bug', 'ko')).toBe('en')
  expect(pickLang('auto', 'Fix the 로그인 bug', 'en')).toBe('ko')
  expect(pickLang('auto', '12345 !!!', 'ko')).toBe('ko')
  expect(pickLang('auto', '12345 !!!', 'en')).toBe('en')
  expect(pickLang('auto', '', 'en')).toBe('en')
  expect(pickLang(undefined, 'Fix the login bug', 'ko')).toBe('en')
})

test('looksSensitive·sanitizeTitle: 키·토큰·메일 주소처럼 보이는 이름은 버린다', async () => {
  for (const t of [
    'sk-ant-api03 키 오류 수정',
    'Fix ghp_abcdEFGH1234 token',
    'AKIAIOSFODNN7 권한 오류',
    'a1b2c3d4e5f6a7b8c9 해시 확인',
    'me@example.com 로그인 오류',
  ]) {
    expect(looksSensitive(t)).toBe(true)
    expect(sanitizeTitle(t)).toBe(null)
  }
  // 보통 이름은 그대로 쓴다.
  for (const t of [
    'Internationalization setup',
    'SHA256 checksum mismatch',
    'Node 22 업그레이드',
    'desk-top 배치 정리',
    '로그인 오류 원인 찾기',
  ]) {
    expect(looksSensitive(t)).toBe(false)
    expect(sanitizeTitle(t)).toBe(t)
  }
})

test('checkBeforeSet: 그대로면 apply, 앱이 첫 마디 이름을 붙였으면 apply, 사람이 바꿨으면 renamed', async () => {
  const first = '사진 앨범 공유 페이지 만들자'
  // 예약할 때 본 이름 그대로
  expect(checkBeforeSet({ now: 'ᄒᄋ', expected: 'ᄒᄋ', lastTitle: null, firstMessage: 'ㅎㅇ' })).toBe('apply')
  // 앱이 그사이 첫 마디 이름을 붙였다(모드는 아직 지은 적 없음)
  expect(checkBeforeSet({ now: first, expected: '새 창', lastTitle: null, firstMessage: first })).toBe('apply')
  // 사람이 바꿨다
  expect(checkBeforeSet({ now: '내가 정한 이름', expected: 'ᄒᄋ', lastTitle: null, firstMessage: 'ㅎㅇ' })).toBe('renamed')
  expect(
    checkBeforeSet({ now: '내가 정한 이름', expected: '사진 앨범 공유', lastTitle: '사진 앨범 공유', firstMessage: first }),
  ).toBe('renamed')
  // 그사이 모드가 다른 이름을 붙였다(now 등): 이번 건만 버린다
  expect(
    checkBeforeSet({ now: '앨범 공유 개선', expected: '사진 앨범 공유', lastTitle: '앨범 공유 개선', firstMessage: first }),
  ).toBe('skip')
})

test('maskSensitive: 키·토큰·메일 주소·키 같은 긴 글자열만 가리고 보통 글은 둔다', async () => {
  expect(maskSensitive('sk-ant-api03-abcDEF123 키로 접속 안 됨')).toBe('[redacted] 키로 접속 안 됨')
  expect(maskSensitive('토큰 ghp_abcdEFGH1234 를 바꿨다')).toBe('토큰 [redacted] 를 바꿨다')
  expect(maskSensitive('me@example.com 으로 알림')).toBe('[redacted] 으로 알림')
  expect(maskSensitive('해시 a1b2c3d4e5f6a7b8c9 확인')).toBe('해시 [redacted] 확인')
  for (const t of [
    'github.com/example/desktop-session-namer 저장소',
    'session-namer-v5.0-2026-11-25 백업',
    'Internationalization setup',
    'SHA256 checksum mismatch',
    'task-runner 설정',
    '로그인 오류 원인 찾기',
  ]) {
    expect(maskSensitive(t)).toBe(t)
  }
})

test('renamedBeforeNaming: 모드가 짓기 전에 사람이 이름을 바꿨는가', async () => {
  const first = '사진 앨범 공유 페이지 만들자'
  const base = { lastTitle: null, firstMessage: 'ㅎㅇ' }
  // 그대로
  expect(renamedBeforeNaming({ ...base, title: 'ᄒᄋ', lastSeenTitle: 'ᄒᄋ' })).toBe(false)
  // 짧은 이름으로 바꿨다(짧다고 덮어쓰면 안 된다)
  expect(renamedBeforeNaming({ ...base, title: 'DB', lastSeenTitle: 'ᄒᄋ' })).toBe(true)
  // 앱이 자리 이름을 첫 마디로 바꿨다(자른 것 포함)
  expect(renamedBeforeNaming({ lastTitle: null, firstMessage: first, title: first, lastSeenTitle: '새 창' })).toBe(false)
  expect(renamedBeforeNaming({ lastTitle: null, firstMessage: first, title: '사진 앨범', lastSeenTitle: '새 창' })).toBe(
    false,
  )
  // 처음 보거나, 모드가 이미 지었거나(judge 가 본다), 첫 메시지를 모르면 판단하지 않는다
  expect(renamedBeforeNaming({ ...base, title: 'DB', lastSeenTitle: null })).toBe(false)
  expect(renamedBeforeNaming({ ...base, title: 'DB', lastSeenTitle: 'ᄒᄋ', lastTitle: '앨범' })).toBe(false)
  expect(renamedBeforeNaming({ ...base, title: 'DB', lastSeenTitle: 'ᄒᄋ', firstMessage: null })).toBe(false)
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


test('excerpt: 공백을 걷고 max자를 넘으면 자르고 …', async () => {
  expect(excerpt('  안녕  ', 10)).toBe('안녕')
  expect(excerpt('가나다라마', 5)).toBe('가나다라마')
  expect(excerpt('가나다라마바', 5)).toBe('가나다라마…')
  // 코드 포인트 기준(이모지 하나가 한 글자)
  expect(excerpt('😀😀😀😀', 3)).toBe('😀😀😀…')
  expect(excerpt(undefined, 5)).toBe('')
  expect(USER_EXCERPT).toBe(1000)
  expect(ANSWER_EXCERPT).toBe(800)
})

test('buildNamingRequest: 종류·언어별 system 문장', async () => {
  const ko = buildNamingRequest('first', 'ko', '메모', '사진 앨범 공유 만들자', '네, 시작합니다')
  expect(ko.system).toContain('대화 세션의 사이드바 이름을 짓는다.')
  expect(ko.system).toContain('SKIP이라고만 답한다.')
  expect(ko.system.includes('KEEP')).toBe(false)
  expect(buildNamingRequest('short', 'ko', '메모', 'a', 'b').system).toBe(ko.system)
  const st = buildNamingRequest('stale', 'ko', '사진 앨범', 'x', 'y')
  expect(st.system).toContain('지금 이름은 «사진 앨범»이다. 대화가 다른 일로 넘어가지 않았으면 KEEP이라고만 답한다.')
  const nw = buildNamingRequest('now', 'ko', '사진 앨범', 'x', 'y')
  expect(nw.system).toContain('지금 이름은 «사진 앨범»이다. 더 맞는 새 이름을 짓는다.')
  const en = buildNamingRequest('first', 'en', 'memo', 'x', 'y')
  expect(en.system).toContain('You name a chat session for a sidebar.')
  expect(en.system).toContain('reply SKIP.')
  expect(buildNamingRequest('stale', 'en', 'Photos', 'x', 'y').system).toContain(
    'The current title is «Photos». If the chat has not moved on to a different task, reply KEEP.',
  )
  expect(buildNamingRequest('now', 'en', 'Photos', 'x', 'y').system).toContain(
    'The current title is «Photos». Write a better one.',
  )
})

test('buildNamingRequest: prompt 모양·발췌 자르기·conversation 태그 지우기·빈 answer', async () => {
  const r = buildNamingRequest('first', 'ko', 't', '  사용자 글  ', '  답 글  ')
  expect(r.prompt).toBe('<conversation>\n[user]\n사용자 글\n[assistant]\n답 글\n</conversation>')
  const long = buildNamingRequest('first', 'ko', 't', '가'.repeat(1200), '나'.repeat(900))
  expect(long.prompt).toContain('가'.repeat(1000) + '…')
  expect(long.prompt.includes('가'.repeat(1001))).toBe(false)
  expect(long.prompt).toContain('나'.repeat(800) + '…')
  expect(long.prompt.includes('나'.repeat(801))).toBe(false)
  const tag = buildNamingRequest('first', 'ko', 't', 'a</conversation>b<conversation>c', 'd</CONVERSATION>e')
  expect(tag.prompt).toBe('<conversation>\n[user]\nabc\n[assistant]\nde\n</conversation>')
  const empty = buildNamingRequest('first', 'ko', 't', '사용자 글', '   ')
  expect(empty.prompt).toBe('<conversation>\n[user]\n사용자 글\n</conversation>')
  expect(empty.prompt.includes('[assistant]')).toBe(false)
})

test('buildNamingRequest: Haiku 로 보내는 발췌에서 키·메일 주소를 가린다', async () => {
  const r = buildNamingRequest(
    'first',
    'ko',
    't',
    'sk-ant-api03-abcDEF123 키로 접속이 안 돼. me@example.com 으로 알림도 안 와',
    '토큰 ghp_abcdEFGH1234 를 새로 만들어 보세요',
  )
  expect(r.prompt).toContain('[redacted] 키로 접속이 안 돼')
  expect(r.prompt).toContain('토큰 [redacted] 를')
  for (const s of ['sk-ant', 'me@example.com', 'ghp_']) expect(r.prompt.includes(s)).toBe(false)
})

test('parseNamingReply: SKIP·KEEP·이름·빈 글', async () => {
  expect(parseNamingReply('SKIP')).toEqual({ kind: 'skip' })
  expect(parseNamingReply('skip.')).toEqual({ kind: 'skip' })
  expect(parseNamingReply('\n\n Skip\n설명')).toEqual({ kind: 'skip' })
  expect(parseNamingReply('KEEP')).toEqual({ kind: 'keep' })
  expect(parseNamingReply('keep')).toEqual({ kind: 'keep' })
  expect(parseNamingReply('"사진 앨범 공유."')).toEqual({ kind: 'title', title: '사진 앨범 공유' })
  expect(parseNamingReply('\n사진 앨범 공유\n둘째 줄')).toEqual({ kind: 'title', title: '사진 앨범 공유' })
  // 단어 경계: skipper 는 SKIP 이 아니다.
  expect(parseNamingReply('Skipper game design')).toEqual({ kind: 'title', title: 'Skipper game design' })
  expect(parseNamingReply('')).toEqual({ kind: 'bad' })
  expect(parseNamingReply('   \n ')).toEqual({ kind: 'bad' })
  expect(parseNamingReply('가')).toEqual({ kind: 'bad' })
  expect(parseNamingReply(undefined)).toEqual({ kind: 'bad' })
})

// 0.4.0이 state-v2 로 저장한 모양(modelFails·usage 없음, 기록에 'hint').
const V2_OFF = {
  off: 'manual',
  lastTitle: '사진 앨범 공유 페이지',
  promptsSinceSet: 3,
  forceNext: false,
  lastSeenTitle: '사진 앨범 공유 페이지',
  history: [
    { at: 1, action: 'hint' },
    { at: 2, action: 'set', title: '사진 앨범 공유 페이지' },
  ],
}

const INITIAL_T = {
  off: null,
  lastTitle: null,
  promptsSinceSet: 0,
  forceNext: false,
  lastSeenTitle: null,
  history: [],
  modelFails: 0,
  usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, last: null },
}

test('normalizeState: 0.4.0 값은 지키고 빈 칸(modelFails·usage)만 채운다', async () => {
  const s = normalizeState(V2_OFF as any, INITIAL_T as any)
  expect(s.off).toBe('manual')
  expect(s.lastTitle).toBe('사진 앨범 공유 페이지')
  expect(s.lastSeenTitle).toBe('사진 앨범 공유 페이지')
  expect(s.promptsSinceSet).toBe(3)
  expect(s.history.length).toBe(2)
  expect(s.history[0]?.action).toBe('hint')
  expect(s.modelFails).toBe(0)
  expect(s.usage).toEqual({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, last: null })
  // INITIAL 의 usage 를 함께 쓰지 않는다(사본).
  expect(s.usage === (INITIAL_T as any).usage).toBe(false)
})

test('normalizeState: 빈 값·깨진 칸도 죽지 않는다', async () => {
  expect(normalizeState(undefined, INITIAL_T as any)).toEqual(INITIAL_T as any)
  expect(normalizeState(null, INITIAL_T as any)).toEqual(INITIAL_T as any)
  const s = normalizeState(
    { history: 'x', modelFails: 'two', usage: { calls: 2, input: NaN, last: 5 } } as any,
    INITIAL_T as any,
  )
  expect(s.history).toEqual([])
  expect(s.modelFails).toBe(0)
  expect(s.usage).toEqual({ calls: 2, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, last: null })
})

// ---------- 통합: 앱 도구와 모델 호출을 가짜로 세운다 ----------

const GET = 'mcp__ccd_session_mgmt__get_session'
const SET = 'mcp__ccd_session_mgmt__set_session_title'

type Rig = {
  sets: string[]
  gets: number
  /** model.complete 로 들어온 요청들 */
  calls: any[]
  toasts: string[]
}

type RigOpts = {
  title: () => string
  /** 이 세션의 사용자 메시지(기록에 이미 있는 것). */
  history?: string[]
  /** 이 세션의 assistant 글(사용자 메시지 뒤에 이어 붙는다). */
  answers?: string[]
  extra?: Record<string, unknown>
  setText?: string
  setError?: boolean
  getError?: boolean
  messagesDeny?: boolean
  /** n 번째(0부터) model.complete 의 답. 없으면 '사진 앨범 공유 페이지'. */
  reply?: (n: number, e: any) => unknown
}

const usageOf = (input = 10, output = 5, cacheRead = 2, cacheWrite = 1) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
})

const ans = (text: string, usage = usageOf()) => ({ isAnswered: true, text, usage })
const fail = () => ({
  isAnswered: false,
  reason: 'api-error',
  status: 529,
  error: 'overloaded',
  usage: usageOf(0, 0, 0, 0),
})

async function rig($: any, on: any, opts: RigOpts): Promise<Rig> {
  const r: Rig = { sets: [], gets: 0, calls: [], toasts: [] }
  on('command.register', () => ({ value: { command: 'session-name' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('ui.toast', (_: unknown, e: any) => {
    r.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.messages', () => {
    if (opts.messagesDeny) return { value: { deny: 'no rows' } }
    return {
      value: [
        ...(opts.history ?? []).map(t => ({ role: 'user', text: t, toolUses: [] })),
        ...(opts.answers ?? []).map(t => ({ role: 'assistant', text: t, toolUses: [] })),
      ],
    }
  })
  on('model.complete', (_: unknown, e: any) => {
    const n = r.calls.length
    r.calls.push(e)
    const out = (opts.reply ? opts.reply(n, e) : ans('사진 앨범 공유 페이지')) as any
    return out && out.deny ? out : { value: out }
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

/** 사용자 메시지를 보내고, 모델이 받은 e 를 돌려준다. */
async function say($: any, text: string, extra: Record<string, unknown> = {}): Promise<any> {
  const out = await $.prompt.submit({ text, ...extra })
  await settle()
  return out
}

/** 턴이 끝난다. */
async function finish($: any, answerText = '네, 시작하겠습니다.', extra: Record<string, unknown> = {}): Promise<any> {
  const out = await $.turn.complete({
    answer: answerText,
    durationMs: 10,
    isAborted: false,
    turnId: 't' + Math.random().toString(36).slice(2),
    reason: 'answer',
    ...extra,
  })
  await settle()
  return out
}

/** 메시지 하나와 그 턴의 끝. */
async function turn($: any, text: string, answerText?: string): Promise<void> {
  await say($, text)
  await finish($, answerText)
}

async function cmd($: any, args: string): Promise<string> {
  const out = await $.command.run({ command: 'session-name', args })
  await settle()
  return out.text ?? ''
}

test('첫 마디 이름 + 긴 메시지 → prompt.submit 에는 안내(context)가 붙지 않는다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  const out = await say($, '사진 앨범 공유 페이지 만들자')
  expect(out.context ?? []).toEqual([])
  expect(out.text).toBe('사진 앨범 공유 페이지 만들자')
  expect(r.gets).toBe(1)
  // 턴이 끝나기 전에는 모델을 부르지 않는다.
  expect(r.calls.length).toBe(0)
})

test('turn.complete(answer) → Haiku 를 한 번 부르고 그 답으로 set 한다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '사진 앨범 공유 페이지 만들자')
  const out = await finish($, '네, 앨범 목록부터 만들겠습니다.')
  // 턴의 결과는 그대로 돌려준다.
  expect(out.text).toBe('네, 앨범 목록부터 만들겠습니다.')
  expect(r.calls.length).toBe(1)
  const c = r.calls[0]
  expect(c.model).toBe('haiku')
  expect(c.effort).toBe('low')
  expect(c.maxTokens).toBe(1024)
  expect(c.timeoutMs).toBe(30000)
  expect(c.prompt).toContain('[user]\n사진 앨범 공유 페이지 만들자')
  expect(c.prompt).toContain('[assistant]\n네, 앨범 목록부터 만들겠습니다.')
  expect(c.system).toContain('대화 세션의 사이드바 이름을 짓는다.')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  expect(r.toasts).toEqual(['세션 이름 → 사진 앨범 공유 페이지'])
  const status = await cmd($, '')
  expect(status).toContain('켜짐')
  expect(status).toContain('queue ᄒᄋ (first)')
})

test('첫 메시지가 기록에 아직 없으면 지금 메시지를 첫 메시지로 본다', async ($, on) => {
  const r = await rig($, on, { title: () => '사진 앨범', history: [] })
  await turn($, '사진 앨범 공유 페이지 만들자')
  expect(r.calls.length).toBe(1)
})

test('turn.complete reason aborted → 모델을 안 부르고, 다음 메시지에서 다시 판정한다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '사진 앨범 공유 페이지 만들자')
  await finish($, '', { reason: 'aborted', isAborted: true })
  expect(r.calls.length).toBe(0)
  // 예약이 비워졌으니 같은 턴 끝을 또 보내도 부르지 않는다.
  await finish($)
  expect(r.calls.length).toBe(0)
  await turn($, '다시 앨범 공유 페이지 만들자')
  expect(r.calls.length).toBe(1)
})

test('turn.complete reason refusal·error → 모델을 안 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '사진 앨범 공유 페이지 만들자')
  await finish($, '', { reason: 'error' })
  await say($, '사진 앨범 공유 페이지 다시 만들자')
  await finish($, '', { reason: 'refusal', refusal: { category: null, explanation: null } })
  expect(r.calls.length).toBe(0)
})

test('서브에이전트의 turn.complete(agentId) → 안 부르고 예약도 남는다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '사진 앨범 공유 페이지 만들자')
  await finish($, '서브에이전트 보고', { agentId: 'a1' })
  expect(r.calls.length).toBe(0)
  await finish($, '메인 답')
  expect(r.calls.length).toBe(1)
  expect(r.calls[0].prompt).toContain('메인 답')
  expect(r.calls[0].prompt.includes('서브에이전트 보고')).toBe(false)
})

test('예약이 없는 턴(own 판정)의 turn.complete → 안 부른다', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(1)
  title = '사진 앨범 공유 페이지'
  await turn($, '다음 일을 해 보자')
  expect(r.calls.length).toBe(1)
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
})

test('Haiku 답 SKIP → set 안 부르고 skip 기록', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], reply: () => ans('SKIP') })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(1)
  expect(r.sets).toEqual([])
  expect(await cmd($, '')).toContain('skip (model-skip)')
})

test('stale 에서 Haiku 답 KEEP → set 안 부름', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, {
    title: () => title,
    history: ['ㅎㅇ'],
    reply: n => (n === 0 ? ans('사진 앨범 공유 페이지') : ans('KEEP')),
  })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  title = '사진 앨범 공유 페이지'
  for (let i = 0; i < 29; i++) await turn($, `일 ${i}번째 작업 진행`)
  expect(r.calls.length).toBe(1)
  await turn($, '서른째 작업 진행해 보자')
  expect(r.calls.length).toBe(2)
  expect(r.calls[1].system).toContain('지금 이름은 «사진 앨범 공유 페이지»이다.')
  expect(r.calls[1].system).toContain('KEEP')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  expect(await cmd($, '')).toContain('same (model-keep)')
  // 점검 뒤에는 카운터가 0 으로 돌아가 바로 또 부르지 않는다.
  await turn($, '그다음 작업 진행해 보자')
  expect(r.calls.length).toBe(2)
})

test('Haiku 답에 따옴표·마침표 → 다듬어서 set', async ($, on) => {
  const r = await rig($, on, {
    title: () => 'ᄒᄋ',
    history: ['ㅎㅇ'],
    reply: () => ans('"사진 앨범 공유 페이지."\n설명은 하지 않습니다'),
  })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
})

test('Haiku 답이 쓸 수 없는 이름(너무 짧음)이면 set 안 부르고 bad-title', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], reply: () => ans('가') })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.sets).toEqual([])
  expect(await cmd($, '')).toContain('skip (bad-title)')
})

test('이름이 지금 이름과 같으면 set 을 안 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], reply: () => ans('ᄒᄋ') })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(1)
  expect(r.sets).toEqual([])
})

test('model.complete 가 isAnswered false 로 3번 연속 → off model-failed, 이후 안 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], reply: () => fail() })
  await turn($, '첫째 앨범 공유 일을 시작하자')
  await turn($, '둘째 앨범 공유 일을 시작하자')
  expect((await cmd($, '')).split('\n')[0]).toContain('켜짐')
  await turn($, '셋째 앨범 공유 일을 시작하자')
  expect(r.calls.length).toBe(3)
  const status = await cmd($, '')
  expect(status).toContain('꺼짐 (model-failed)')
  expect(status).toContain('error (model: api-error 529)')
  await turn($, '넷째 앨범 공유 일을 시작하자')
  expect(r.calls.length).toBe(3)
  expect(r.sets).toEqual([])
})

test('중간에 한 번 성공하면 연속 실패로 세지 않는다', async ($, on) => {
  const replies = [fail(), fail(), ans('SKIP'), fail(), fail()]
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], reply: n => replies[n] })
  for (const w of ['첫째', '둘째', '셋째', '넷째', '다섯째']) await turn($, `${w} 앨범 공유 일을 시작하자`)
  expect(r.calls.length).toBe(5)
  expect((await cmd($, '')).split('\n')[0]).toContain('켜짐')
})

test('model.complete 를 보내지도 못하면 off model-unavailable', async ($, on) => {
  const r = await rig($, on, {
    title: () => 'ᄒᄋ',
    history: ['ㅎㅇ'],
    reply: () => ({ deny: 'model blocked by allowlist' }),
  })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(1)
  const status = await cmd($, '')
  expect(status).toContain('꺼짐 (model-unavailable)')
  expect(r.sets).toEqual([])
})

test('usage 가 상태에 쌓이고 /session-name 출력에 호출 수·토큰이 보인다', async ($, on) => {
  let title = 'ᄒᄋ'
  const replies = [ans('사진 앨범 공유 페이지', usageOf(100, 7, 20, 3)), ans('KEEP', usageOf(50, 1, 0, 0))]
  await rig($, on, { title: () => title, history: ['ㅎㅇ'], reply: n => replies[n] })
  expect(await cmd($, '')).toContain('Haiku 호출 0번')
  await turn($, '앨범 공유 페이지 시작하자')
  title = '사진 앨범 공유 페이지'
  for (let i = 0; i < 29; i++) await turn($, `일 ${i}번째 작업 진행`)
  await turn($, '서른째 작업 진행해 보자')
  const s = await cmd($, '')
  expect(s).toContain('Haiku 호출 2번, 토큰 입력 150·출력 8·캐시 읽기 20·캐시 쓰기 3')
  expect(s).toContain('마지막 호출: 입력 50·출력 1')
})

test('/session-name now → 기다리지 않고 바로 model.complete 를 부르고 set 한다', async ($, on) => {
  const r = await rig($, on, {
    title: () => '린트 규칙 정리',
    history: ['이 폴더의 린트 규칙을 정리하고 시험까지 돌려 줘. 끝나면 보고해'],
    answers: ['정리했습니다. 시험도 통과했습니다.'],
    reply: () => ans('린트 규칙 정리와 시험 실행'),
  })
  await turn($, '계속해서 시험까지 돌려 줘')
  expect(r.calls.length).toBe(0)
  expect(await cmd($, 'now')).toContain('짓는 중')
  expect(r.calls.length).toBe(1)
  const c = r.calls[0]
  expect(c.system).toContain('지금 이름은 «린트 규칙 정리»이다. 더 맞는 새 이름을 짓는다.')
  expect(c.prompt).toContain('[user]\n이 폴더의 린트 규칙을 정리하고')
  expect(c.prompt).toContain('[assistant]\n정리했습니다. 시험도 통과했습니다.')
  expect(r.sets).toEqual(['린트 규칙 정리와 시험 실행'])
  expect(r.toasts).toEqual(['세션 이름 → 린트 규칙 정리와 시험 실행'])
})

test('now 는 user-renamed 로 꺼진 세션에서도 지으며, 새 이름을 받으면 다시 켠다', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, {
    title: () => title,
    history: ['ㅎㅇ', '앨범 공유 페이지 시작하자'],
    answers: ['네'],
    reply: n => ans(n === 0 ? '사진 앨범 공유 페이지' : '앨범 공유 페이지 개선'),
  })
  await turn($, '앨범 공유 페이지 시작하자')
  title = '내가 정한 이름'
  await say($, '다음 일을 해 보자')
  expect(await cmd($, '')).toContain('user-renamed')
  expect(await cmd($, 'now')).toContain('짓는 중')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지', '앨범 공유 페이지 개선'])
  expect((await cmd($, '')).split('\n')[0]).toContain('켜짐')
})

test('now: 기록을 못 읽으면 다음 턴 끝으로 미룬다(off 여도 한 번)', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', messagesDeny: true })
  await cmd($, 'off')
  expect(await cmd($, 'now')).toContain('다음 메시지의 턴이 끝나면')
  expect(r.calls.length).toBe(0)
  expect(await cmd($, '')).toContain('다음 턴 끝에 이름 짓기 예약됨')
  await say($, 'ㅇㅋ')
  await finish($)
  expect(r.calls.length).toBe(1)
  expect(r.calls[0].system).toContain('더 맞는 새 이름을 짓는다.')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  // 한 번만 쓴다.
  await turn($, '그다음 일을 해 보자')
  expect(r.calls.length).toBe(1)
})

test('짧은 메시지("ㅇㅋ")면 예약을 안 만들고 get_session 은 한 번 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await turn($, 'ㅇㅋ')
  expect(r.calls.length).toBe(0)
  expect(r.gets).toBe(1)
  expect(await cmd($, '')).toContain('skip (trivial)')
})

test('짧은 메시지 다음의 긴 메시지에서만 모델을 부른다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await turn($, 'ㅎㅇ')
  expect(r.calls.length).toBe(0)
  await turn($, '사진 앨범 공유 페이지 만들자')
  expect(r.calls.length).toBe(1)
  // 메시지마다 한 번, 이름을 붙이기 직전에 한 번 더 읽는다.
  expect(r.gets).toBe(3)
})

test('메시지 기록을 못 읽으면 짧은 이름 규칙만 쓴다(짧으면 지음)', async ($, on) => {
  const r = await rig($, on, { title: () => '뭐지', messagesDeny: true })
  await turn($, '아주 긴 지시문이 이어집니다')
  expect(r.calls.length).toBe(1)
})

test('메시지 기록을 못 읽고 이름이 길면 안 짓는다', async ($, on) => {
  const r = await rig($, on, { title: () => '긴 이름이지만 첫 마디', messagesDeny: true })
  await turn($, '긴 이름이지만 첫 마디')
  expect(r.calls.length).toBe(0)
})

test('제목 "린트 규칙 정리" + 긴 첫 지시문 → 안 짓는다', async ($, on) => {
  const r = await rig($, on, {
    title: () => '린트 규칙 정리',
    history: ['이 폴더의 린트 규칙을 정리하고 시험까지 돌려 줘. 끝나면 보고해'],
  })
  await turn($, '계속해서 시험까지 돌려 줘')
  expect(r.calls.length).toBe(0)
  expect(r.gets).toBe(1)
})

test('앱이 첫 메시지를 잘라 이름으로 쓴 경우에도 짓는다', async ($, on) => {
  const first = '사진 앨범 공유 페이지를 만들어 줘. 날짜별로 묶어서 보여 줘'
  const r = await rig($, on, { title: () => '사진 앨범 공유 페이지를 만들어 줘. 날짜별로', history: [first] })
  await turn($, '계속해서 결제 화면도 만들어 줘')
  expect(r.calls.length).toBe(1)
})

test('lastTitle 과 다른 지금 이름 → user-renamed, 이후 안 읽고 안 부른다', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  title = '내가 정한 이름'
  await turn($, '다음 일')
  expect(await cmd($, '')).toContain('user-renamed')
  expect(r.calls.length).toBe(1)
  const before = r.gets
  await turn($, '또 다음 일')
  expect(r.gets).toBe(before)
  expect(r.calls.length).toBe(1)
})

test('예약 작업 세션 → 아무것도 안 한다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], extra: { scheduledTaskId: 'task-1' } })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(0)
  expect(r.sets).toEqual([])
  expect(await cmd($, '')).toContain('scheduled')
})

test('도구가 없으면(unavailable) 이 세션에서는 끈다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], getError: true })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(0)
  expect(await cmd($, '')).toContain('unavailable')
  const before = r.gets
  await turn($, '또 다른 일을 해 보자')
  expect(r.gets).toBe(before)
})

test('슬래시 명령·isMeta 메시지는 예약도 도구 호출도 안 한다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '/compact', { command: { name: 'compact', args: '' } })
  await finish($)
  await say($, '시스템이 보낸 알림', { isMeta: true })
  await finish($)
  expect(r.gets).toBe(0)
  expect(r.calls.length).toBe(0)
  await turn($, '진짜 말 시작해 보자')
  expect(r.calls.length).toBe(1)
})

test('모드가 지은 이름: 29개째까지는 조용하고 30개째에 점검(기본 30)', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await turn($, '앨범 공유 페이지 시작하자')
  title = '사진 앨범 공유 페이지' // 앱이 바꾼 이름이 보이게 된다
  for (let i = 0; i < 29; i++) await turn($, `일 ${i}번째 작업 진행`)
  expect(r.calls.length).toBe(1)
  await turn($, '서른째 작업 진행해 보자')
  expect(r.calls.length).toBe(2)
  expect(r.calls[1].system).toContain('KEEP')
})

test('recheckEvery 0: 40개가 지나도 점검이 없다', { options: { recheckEvery: 0 } }, async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await turn($, '앨범 공유 페이지 시작하자')
  title = '사진 앨범 공유 페이지'
  for (let i = 0; i < 40; i++) await turn($, `일 ${i}번째 작업 진행`)
  expect(r.calls.length).toBe(1)
})

test('recheckEvery 5: 5개째에 점검', { options: { recheckEvery: 5 } }, async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await turn($, '앨범 공유 페이지 시작하자')
  title = '사진 앨범 공유 페이지'
  for (let i = 0; i < 4; i++) await turn($, `일 ${i}번째 작업 진행`)
  expect(r.calls.length).toBe(1)
  await turn($, '다섯째 작업 진행해 보자')
  expect(r.calls.length).toBe(2)
})

test('/session-name off 뒤에는 예약도 도구 호출도 없다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  expect(await cmd($, 'off')).toContain('껐')
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(0)
  expect(r.gets).toBe(0)
  expect(await cmd($, 'on')).toContain('켰')
  await turn($, '다시 앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(1)
})

// ---------- 0.5.1: 붙이기 직전 다시 보기, on 기준 ----------

test('턴 도중 사람이 이름을 바꾸면 턴이 끝나도 덮어쓰지 않고 끈다', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  title = '내가 정한 이름' // 긴 작업 도중 사이드바에서 바꿨다
  await finish($)
  expect(r.sets).toEqual([])
  expect(r.toasts).toEqual([])
  const s = await cmd($, '')
  expect(s).toContain('꺼짐 (user-renamed)')
  // 이후 메시지에서도 건드리지 않는다.
  await turn($, '다음 일을 해 보자')
  expect(r.sets).toEqual([])
})

test('턴 도중 앱이 첫 마디 이름을 붙인 경우는 그대로 짓는다', async ($, on) => {
  const first = '사진 앨범 공유 페이지 만들자'
  let title = '새 창'
  const r = await rig($, on, { title: () => title, history: [] })
  await say($, first)
  title = first // 앱이 첫 메시지로 이름을 붙였다
  await finish($)
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
})

test('턴 도중 /session-name off → 그 턴 끝에 Haiku 를 부르지 않는다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await say($, '앨범 공유 페이지 시작하자')
  await cmd($, 'off')
  await finish($)
  expect(r.calls.length).toBe(0)
  expect(r.sets).toEqual([])
})

test('Haiku 를 기다리는 사이 꺼지면 붙이지 않는다', async ($, on) => {
  const r = await rig($, on, {
    title: () => 'ᄒᄋ',
    history: ['ㅎㅇ'],
    reply: () => {
      // 답이 돌아오는 사이 사람이 끈다.
      void cmd($, 'off')
      return ans('사진 앨범 공유 페이지')
    },
  })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.calls.length).toBe(1)
  expect(r.sets).toEqual([])
  expect(await cmd($, '')).toContain('skip (turned-off)')
})

test('on: 사람이 정한 이름을 새 기준으로 삼아 30개째에 다시 보고, 또 바꾸면 다시 끈다', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, {
    title: () => title,
    history: ['ㅎㅇ'],
    reply: n => ans(n === 0 ? '사진 앨범 공유 페이지' : 'KEEP'),
  })
  await turn($, '앨범 공유 페이지 시작하자')
  title = '내가 정한 이름'
  await turn($, '다음 일을 해 보자')
  expect(await cmd($, '')).toContain('user-renamed')
  expect(await cmd($, 'on')).toContain('새 기준')
  expect(await cmd($, '')).toContain('마지막으로 정한 이름: 내가 정한 이름')
  for (let i = 0; i < 29; i++) await turn($, `일 ${i}번째 작업 진행`)
  expect(r.calls.length).toBe(1)
  await turn($, '서른째 작업 진행해 보자')
  expect(r.calls.length).toBe(2)
  expect(r.calls[1].system).toContain('«내가 정한 이름»')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  title = '또 바꾼 이름'
  await turn($, '다음 일을 또 해 보자')
  expect(await cmd($, '')).toContain('꺼짐 (user-renamed)')
})

test('on: 첫 마디 이름이면 기준을 비워 다음 메시지에서 짓고, 연속 실패 수도 비운다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], reply: () => fail() })
  for (let i = 0; i < 3; i++) await turn($, `앨범 공유 페이지 ${i}번째 시도`)
  expect(await cmd($, '')).toContain('model-failed')
  await cmd($, 'on')
  expect(await cmd($, '')).toContain('마지막으로 정한 이름: 없음')
  // 한 번 더 실패해도 바로 꺼지지 않는다(세 번까지).
  await turn($, '앨범 공유 페이지 다시 시도')
  expect(r.calls.length).toBe(4)
  expect((await cmd($, '')).split('\n')[0]).toContain('켜짐')
})

// ---------- 0.5.2: 짓기 전 짧은 이름, now 뒤 off ----------

test('모드가 짓기 전에 사람이 짧은 이름으로 바꾸면 덮어쓰지 않고 끈다', async ($, on) => {
  let title = 'ᄒᄋ'
  const r = await rig($, on, { title: () => title, history: ['ㅎㅇ'] })
  await turn($, 'ㅇㅋ') // 짧은 말이라 아직 안 짓는다
  title = 'DB' // 사이드바에서 짧게 바꿨다
  await turn($, '데이터베이스 색인을 정리하자')
  expect(r.calls.length).toBe(0)
  expect(r.sets).toEqual([])
  expect(await cmd($, '')).toContain('꺼짐 (user-renamed)')
})

test('앱이 자리 이름을 첫 마디로 바꾼 것은 사람이 바꾼 것으로 보지 않는다', async ($, on) => {
  let title = '새 창'
  const history: string[] = []
  const r = await rig($, on, { title: () => title, history })
  await turn($, 'ㅇㅋ')
  history.push('ㅇㅋ')
  title = 'ㅇㅋ' // 앱이 첫 메시지로 이름을 붙였다
  await turn($, '사진 앨범 공유 페이지 만들자')
  expect(r.calls.length).toBe(1)
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
})

test('now 를 시킨 뒤 Haiku 를 기다리는 사이 off 하면 붙이지 않고, off 뒤에 시킨 now 는 붙인다', async ($, on) => {
  const r = await rig($, on, {
    title: () => 'ᄒᄋ',
    history: ['사진 앨범 공유 페이지 만들자'],
    answers: ['네, 앨범 목록부터 만들겠습니다.'],
    reply: n => {
      if (n === 0) void cmd($, 'off') // 답이 돌아오는 사이 사람이 끈다
      return ans('사진 앨범 공유 페이지')
    },
  })
  await cmd($, 'now')
  expect(r.calls.length).toBe(1)
  expect(r.sets).toEqual([])
  expect(await cmd($, '')).toContain('skip (turned-off)')
  // 끈 뒤에 사람이 직접 now 를 시키면 그건 붙인다.
  await cmd($, 'now')
  expect(r.calls.length).toBe(2)
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
})

test('앱이 거절하면 이 세션에서는 끈다', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], setText: 'User declined the title change' })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.sets.length).toBe(1)
  expect(await cmd($, '')).toContain('set-refused')
})

test('제목에 "거절"이 들어 있어도 끄지 않는다', async ($, on) => {
  const r = await rig($, on, {
    title: () => '거절',
    history: ['거절'],
    reply: () => ans('거절 메일 답장 정리'),
  })
  await turn($, '메일 답장 정리하자')
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

/** 0.4.0이 남긴 값을 들고 있는 저장소를 세운다. 쓰기는 버전을 올려 받아 준다. */
function seedStore(on: any, value: unknown, shape = 'state-v2'): { stored: () => any } {
  let stored: any = { shape, value }
  let version = 1
  on('state.get', () => ({ value: { value: stored, version } }))
  on('state.set', (_: unknown, e: any) => {
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
    stored = e.value
    version++
    return { value: { isSet: true, version } }
  })
  return { stored: () => stored }
}

test('0.4.0 상태(state-v2)를 이어 읽는다: 끈 세션은 꺼진 채, 토큰 줄은 0', async ($, on) => {
  const db = seedStore(on, V2_OFF)
  const r = await rig($, on, { title: () => '사진 앨범 공유 페이지', history: ['앨범 공유 페이지 만들자'] })
  const s = await cmd($, '')
  expect(s).toContain('상태: 꺼짐 (manual)')
  expect(s).toContain('마지막으로 정한 이름: 사진 앨범 공유 페이지')
  expect(s).toContain('Haiku 호출 0번')
  expect(s).toContain('hint')
  // 상태 명령은 지금 이름을 한 번 읽는다. 그 뒤로는 읽지 않아야 한다.
  const g0 = r.gets
  await turn($, '댓글 기능도 붙여 줘')
  expect(r.calls.length).toBe(0)
  expect(r.gets).toBe(g0)
  // 켜면 같은 태그로 쓰고, 0.4.0 기록은 남기고 새 칸을 채운다.
  // 0.5.1: on 은 지금 이름(사람이 정한 이름)을 새 기준으로 lastTitle 에 둔다.
  expect(await cmd($, 'on')).toContain('켰')
  const w = db.stored()
  expect(w.shape).toBe('state-v2')
  expect(w.value.off).toBe(null)
  expect(w.value.lastTitle).toBe('사진 앨범 공유 페이지')
  expect(w.value.lastSeenTitle).toBe('사진 앨범 공유 페이지')
  expect(w.value.history.map((h: any) => h.action)).toEqual(['hint', 'set'])
  expect(w.value.modelFails).toBe(0)
  expect(w.value.usage.calls).toBe(0)
})

test('0.4.0 상태에서 켜진 세션: 첫 Haiku 호출이 빈 usage 위에 쌓인다', async ($, on) => {
  const db = seedStore(on, { ...V2_OFF, off: null, lastTitle: null, lastSeenTitle: null, promptsSinceSet: 0 })
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.sets).toEqual(['사진 앨범 공유 페이지'])
  const w = db.stored()
  expect(w.shape).toBe('state-v2')
  expect(w.value.usage.calls).toBe(1)
  expect(w.value.usage.input).toBe(10)
  expect(w.value.history.some((h: any) => h.action === 'hint')).toBe(true)
})

// ---------- 언어(영어) ----------

const EN_FIRST = 'Photo album sharing page, please'

test('auto: 영어 메시지 → 영어 system 문장', async ($, on) => {
  const r = await rig($, on, { title: () => 'Photo album', history: [EN_FIRST], reply: () => ans('Photo album sharing page') })
  await turn($, EN_FIRST)
  expect(r.calls.length).toBe(1)
  expect(r.calls[0].system).toContain('You name a chat session for a sidebar.')
  expect(r.calls[0].system.includes('대화 세션')).toBe(false)
})

test('language ko: 영어 메시지에도 한국어 system 문장', { options: { language: 'ko' } }, async ($, on) => {
  const r = await rig($, on, { title: () => 'Photo album', history: [EN_FIRST] })
  await turn($, EN_FIRST)
  expect(r.calls[0].system).toContain('대화 세션의 사이드바 이름을 짓는다.')
  expect(r.calls[0].system.includes('You name')).toBe(false)
})

test('language en: 한국어 메시지에도 영어 system 문장', { options: { language: 'en' } }, async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'], reply: () => ans('Photo album sharing page') })
  await turn($, '사진 앨범 공유 페이지 만들자')
  expect(r.calls[0].system).toContain('You name a chat session for a sidebar.')
  expect(r.calls[0].system.includes('대화 세션')).toBe(false)
})

test('영어 대화에서 이름이 바뀌면 알림이 영어', async ($, on) => {
  const r = await rig($, on, { title: () => 'Photo album', history: [EN_FIRST], reply: () => ans('Photo album sharing page') })
  await turn($, EN_FIRST, 'Sure, starting now.')
  expect(r.sets).toEqual(['Photo album sharing page'])
  expect(r.toasts).toEqual(['Session title → Photo album sharing page'])
})

test('한국어 대화에서 이름이 바뀌면 알림이 한국어', async ($, on) => {
  const r = await rig($, on, { title: () => 'ᄒᄋ', history: ['ㅎㅇ'] })
  await turn($, '앨범 공유 페이지 시작하자')
  expect(r.toasts).toEqual(['세션 이름 → 사진 앨범 공유 페이지'])
})

test('상태 명령은 마지막 언어로 영어 출력(토큰 줄 포함)', async ($, on) => {
  await rig($, on, { title: () => 'Photo album', history: [EN_FIRST], answers: ['ok'] })
  await say($, EN_FIRST)
  const s = await cmd($, '')
  expect(s).toContain('Status: on')
  expect(s).toContain('Current verdict: first-message title («Photo album»)')
  expect(s).toContain('Last title set: none')
  expect(s).toContain('Haiku calls: 0, tokens in 0 · out 0 · cache read 0 · cache write 0')
  expect(s.includes('Last call:')).toBe(false)
  expect(s).toContain('Recent history:')
  expect(await cmd($, 'zzz')).toContain('Usage:')
  expect(await cmd($, 'off')).toContain('off for this session')
  expect(await cmd($, 'on')).toContain('back on')
  expect(await cmd($, 'now')).toContain('Naming this session now')
})

test('영어 상태: 호출 뒤에는 마지막 호출 줄이 보인다', async ($, on) => {
  await rig($, on, { title: () => 'Photo album', history: [EN_FIRST], reply: () => ans('Photo album sharing page', usageOf(30, 4, 5, 6)) })
  await turn($, EN_FIRST)
  const s = await cmd($, '')
  expect(s).toContain('Haiku calls: 1, tokens in 30 · out 4 · cache read 5 · cache write 6')
  expect(s).toContain('Last call: in 30 · out 4')
})

test('41자 영어 제목이 실제로 적용된다', async ($, on) => {
  const t41 = 'Migrate the legacy billing service to API'
  expect([...t41].length).toBeGreaterThan(40)
  const r = await rig($, on, { title: () => 'Photo album', history: [EN_FIRST], reply: () => ans(t41) })
  await turn($, EN_FIRST)
  expect(r.sets).toEqual([t41])
})
