// session-namer v2: 순수 함수 모음(시험에서 직접 부른다). $ 를 쓰지 않는다.

export const MIN_LEN = 2
export const MAX_LEN = 60
/** judge 에 간격을 안 줬을 때 쓰는 값(시험용 옛 기본). 모드는 userConfig recheckEvery(기본 30)를 넘긴다. */
export const STALE_AFTER = 15
/** 공백 뺀 글자 수가 이 이하면 너무 짧은 이름. */
export const SHORT_MAX = 3

// 괄호는 걷지 않는다: "판매 페이지 (2차)"의 닫는 괄호가 잘리지 않게.
const WRAPPERS = /^[\s"'`*「」『』«»“”‘’]+|[\s"'`*「」『』«»“”‘’]+$/g
const LABEL = /^(?:세션\s*)?(?:제목|이름|title|name)\s*[:：]\s*/i
const TRAILING = /[.。!?！？…]+$/

/** 모델이 쓴 이름을 제목으로 다듬는다. 쓸 수 없으면 null. */
export function sanitizeTitle(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const line = raw.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0)
  if (line === undefined) return null
  let t = line.replace(WRAPPERS, '')
  t = t.replace(LABEL, '')
  t = t.replace(WRAPPERS, '')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(TRAILING, '').trim()
  // 마침표를 걷어낸 뒤 다시 따옴표가 드러날 수 있다.
  t = t.replace(WRAPPERS, '').trim()
  const len = [...t].length
  if (len < MIN_LEN || len > MAX_LEN) return null
  return t
}

/** 도구 호출 자체가 오류·거부인가(본문 글은 보지 않는다). get_session 처럼 본문에 제목이 든 결과에 쓴다. */
export function isToolError(r: { isError?: boolean; deny?: string } | null | undefined): boolean {
  if (!r) return true
  return r.isError === true || typeof r.deny === 'string'
}

/** 도구 결과가 거절·오류인가(본문의 거절 말까지 본다). set_session_title 결과에 쓴다. */
export function isRefusalResult(r: { isError?: boolean; deny?: string; text?: string } | null | undefined): boolean {
  if (!r) return true
  if (r.isError === true) return true
  if (typeof r.deny === 'string') return true
  const text = typeof r.text === 'string' ? r.text : ''
  return /declin|denied|거절/i.test(text)
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

/** get_session 의 본문을 읽는다. JSON 이 아니어도 죽지 않는다. */
export function parseSession(text: string): { title: string | null; data: Record<string, unknown> | null } {
  try {
    const v: unknown = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const data = v as Record<string, unknown>
      const title = typeof data['title'] === 'string' ? (data['title'] as string) : null
      return { title, data }
    }
  } catch {
    // 아래로
  }
  return { title: null, data: null }
}

/** 예약 작업 세션인가: 이름에 schedul 이 든 키가 있고 값이 비어 있지 않다. */
export function isScheduledSession(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false
  return Object.keys(data).some(k => /schedul/i.test(k) && !isEmptyValue(data[k]))
}

/** 비교용: NFKC 로 정규화하고 공백을 모두 뺀다("ㅎㅇ" 호환 자모와 "ᄒᄋ" 첫가끝 자모가 같아진다). */
export function normTitle(s: string): string {
  return s.normalize('NFKC').replace(/\s+/gu, '')
}

export type TitleKind = 'first' | 'short' | null

/**
 * 지금 이름이 첫 마디 이름('first')인지, 너무 짧은 이름('short')인지.
 * firstMessage 를 모르면(null) 짧음만 본다.
 */
export function isAutoTitle(title: string, firstMessage: string | null | undefined): TitleKind {
  const nt = normTitle(title)
  if (nt === '') return 'short'
  if (typeof firstMessage === 'string') {
    const nf = normTitle(firstMessage)
    // 같거나, 앱이 첫 메시지를 잘라 이름으로 썼을 때(첫 메시지가 이름으로 시작).
    if (nf !== '' && nf.startsWith(nt)) return 'first'
  }
  if ([...nt].length <= SHORT_MAX) return 'short'
  return null
}

export type Verdict = 'first' | 'short' | 'stale' | 'own' | 'user-renamed' | 'none'

/** 안내를 붙일지 판정한다. 'first'·'short'·'stale' 이면 붙인다. */
export function judge(args: {
  title: string
  firstMessage: string | null
  lastTitle: string | null
  promptsSinceSet: number
  /** 점검 간격(메시지 수). 0 이면 오래됨 점검을 하지 않는다. 빠지면 STALE_AFTER. */
  recheckEvery?: number
}): Verdict {
  const { title, firstMessage, lastTitle, promptsSinceSet } = args
  const every = args.recheckEvery ?? STALE_AFTER
  if (lastTitle !== null) {
    if (title !== lastTitle) return 'user-renamed'
    return every > 0 && promptsSinceSet >= every ? 'stale' : 'own'
  }
  return isAutoTitle(title, firstMessage) ?? 'none'
}

const MARKER = /<!--\s*session-title\s*:\s*(.+?)\s*-->(?:\r?\n)?/gu

/** 글에서 `<!-- session-title: … -->` 표시를 찾아 지운다. 없으면 found 는 null 이고 text 는 그대로. */
export function extractMarker(text: string): { found: string | null; text: string } {
  if (typeof text !== 'string') return { found: null, text: '' }
  let found: string | null = null
  const out = text.replace(MARKER, (_m: string, g1: string) => {
    if (found === null) found = g1
    return ''
  })
  return { found, text: found === null ? text : out }
}

export type HintKind = 'first' | 'short' | 'stale' | 'now'

/** 이름 오래됨 점검 간격 기본값(메시지 수). 0 이면 점검하지 않는다. */
export const DEFAULT_RECHECK = 30
/** 공백 뺀 글자 수가 이 이하인 메시지("ㅎㅇ", "ㅇㅋ")에는 안내를 붙이지 않는다. */
export const TRIVIAL_MAX = 4

/** 주제가 담길 수 없는 짧은 메시지인가. */
export function isTrivialMessage(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return true
  return [...normTitle(text)].length <= TRIVIAL_MAX
}

/** userConfig 의 점검 간격을 정수로 다듬는다(이상한 값이면 기본값, 음수는 0). */
export function recheckEvery(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_RECHECK
  return Math.max(0, Math.floor(v))
}

export type Lang = 'ko' | 'en'
export type LangOption = 'auto' | Lang

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/u
const LATIN = /\p{Script=Latin}/u

/** 한글 음절·호환 자모·첫가끝 자모가 하나라도 있는가. */
export function hasHangul(text: string | null | undefined): boolean {
  return typeof text === 'string' && HANGUL.test(text)
}

/** 쓸 언어를 정한다. 'ko'·'en' 은 그대로, 'auto' 는 글에서 읽고 판단이 안 서면 fallback. */
export function pickLang(option: unknown, text: string | null | undefined, fallback: Lang): Lang {
  if (option === 'ko' || option === 'en') return option
  if (hasHangul(text)) return 'ko'
  if (typeof text === 'string' && LATIN.test(text)) return 'en'
  return fallback
}

const HINT_TAIL = '`<!-- session-title: 주제를 드러낸 6~22자 한국어 명사구 -->`를 넣고, 이 줄은 언급하지 마라.'
const HINT_TAIL_EN =
  '<!-- session-title: a 2–6 word English title naming the topic, under 40 characters -->'

/**
 * 사용자 메시지 옆에 붙이는 짧은 안내(모델에게만 보인다).
 * 0.2.0(11-25 시험): "작업이 드러나지 않았으면 넣지 않는다"고 하니 질문·거절 대화에서 세 번 다 안 넣었다.
 * 0.2.1: "인사뿐이 아니면 반드시"로 바꿔 실사용에서 바로 지었다(300자).
 * 0.3.0: 예시·설명을 빼고 규칙만 남겼다(130자 안팎). 빠질 길은 "인사뿐"과 "이름이 맞으면(stale)"만 둔다.
 * 0.4.0: 영어판(lang 'en')을 더했다. 첫 안내 290자 안팎, 세 종류 모두 꼬리(HINT_TAIL_EN)를 그대로 붙인다.
 */
export function buildHint(currentTitle: string, kind: HintKind = 'first', lang: Lang = 'ko'): string {
  if (lang === 'en') {
    if (kind === 'stale') {
      return `[session-namer] The sidebar title is «${currentTitle}». Only if the chat has moved on to a different task, start your reply with ${HINT_TAIL_EN} and don't mention that line.`
    }
    if (kind === 'now') {
      return `[session-namer] The user asked for a new sidebar title (now «${currentTitle}»). Start your reply with ${HINT_TAIL_EN} and don't mention that line.`
    }
    return `[session-namer] The sidebar title «${currentTitle}» doesn't say what this chat is about. Unless the message is only a greeting (questions and declined requests count), start your reply with ${HINT_TAIL_EN} and don't mention that line.`
  }
  if (kind === 'stale') {
    return `[session-namer] 사이드바 이름은 «${currentTitle}»이다. 대화가 다른 일로 넘어갔을 때만 답 첫 줄에 ${HINT_TAIL}`
  }
  if (kind === 'now') {
    return `[session-namer] 사용자가 사이드바 이름 «${currentTitle}»을 새로 지어 달라고 했다. 답 첫 줄에 반드시 ${HINT_TAIL}`
  }
  return `[session-namer] 사이드바 이름 «${currentTitle}»로는 대화 주제를 알 수 없다. 인사뿐이 아니면(질문·거절한 요청 포함) 답 첫 줄에 반드시 ${HINT_TAIL}`
}
