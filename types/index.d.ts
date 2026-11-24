export type NamerAction = 'hint' | 'set' | 'same' | 'skip' | 'off' | 'error'

export type NamerEntry = {
  at: number
  action: NamerAction
  title?: string
  reason?: string
}

export type NamerState = {
  /** 꺼진 이유. null 이면 켜짐. */
  off: string | null
  /** 모드가 마지막으로 정한 제목 */
  lastTitle: string | null
  /** 모드가 제목을 정한 뒤(또는 안내를 붙인 뒤) 지난 사용자 메시지 수 */
  promptsSinceSet: number
  /** `/session-name now`: 다음 사용자 메시지에 안내를 한 번 붙인다 */
  forceNext: boolean
  /** 마지막으로 읽은 지금 제목 */
  lastSeenTitle: string | null
  /** 최근 기록 10개 */
  history: NamerEntry[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-namer': { state: Shaped<NamerState> }
  }
}
