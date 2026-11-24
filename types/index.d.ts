/** 'hint' 는 0.4.0까지 쓰던 값이다. 같은 저장 태그(state-v2)를 이어 써서 옛 기록에 남아 있을 수 있다. */
export type NamerAction = 'queue' | 'hint' | 'set' | 'same' | 'skip' | 'off' | 'error'

export type NamerEntry = {
  at: number
  action: NamerAction
  title?: string
  reason?: string
}

/** 한 번 부른 토큰 수(모델 usage 에서 옮긴 것). */
export type NamerTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type NamerUsage = NamerTokens & {
  /** Haiku 를 부른 횟수 */
  calls: number
  /** 마지막 호출의 토큰 수 */
  last: NamerTokens | null
}

export type NamerState = {
  /** 꺼진 이유. null 이면 켜짐. */
  off: string | null
  /** 모드가 마지막으로 정한 제목 */
  lastTitle: string | null
  /** 모드가 제목을 정한 뒤(또는 이름 짓기를 예약한 뒤) 지난 사용자 메시지 수 */
  promptsSinceSet: number
  /** `/session-name now` 를 바로 못 했을 때: 다음 사용자 메시지의 턴 끝에 이름을 짓는다 */
  forceNext: boolean
  /** 마지막으로 읽은 지금 제목 */
  lastSeenTitle: string | null
  /** 최근 기록 10개 */
  history: NamerEntry[]
  /** Haiku 호출이 연속으로 실패한 수(3번이면 끈다) */
  modelFails: number
  /** Haiku 호출 토큰 누계 */
  usage: NamerUsage
}

declare module 'claude-code' {
  interface PluginState {
    'session-namer': { state: Shaped<NamerState> }
  }
}
