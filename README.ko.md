# omo-tool-fold

[English](README.md) | 한국어

도구 출력이 접힌 상태일 때(TUI 기본값, Ctrl+O로 전환) 도구 호출 하나를 한 줄로 줄여 보여 주는 OMO(senpi) 확장입니다. 각 줄에는 도구 이름과 한 일이 나오므로, 긴 세션도 상자 더미가 아니라 로그처럼 읽힙니다. Ctrl+O로 펼치면 모든 도구가 원래 전체 출력을 그대로 보여 줍니다. 내 메시지는 파란 기운, 도구 상자는 거의 흰색으로 바꾼 밝은 테마 `grok-day-focus`도 함께 들어 있습니다.

## 화면에 보이는 것

```
eval js ✓ Read config files and list extension folder
edit extension/tool-fold.ts (+12/-3)
todo done: A 확인
web_search bun webview screenshot
write .omo/drafts/fold-b.txt
memory insert notes/a.md
```

실행 중인 eval 셀은 `✓` 자리에 상태 단어(예: `running`)가 나옵니다. 나머지 접히는 도구는 실행 중일 때 끝에 ` …`가 붙습니다.

## 설치

클론 없이 한 줄로 설치합니다. Windows (PowerShell 5.1):

```powershell
irm https://raw.githubusercontent.com/yjacket/omo-tool-fold/master/install.ps1 | iex
```

Linux, macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/yjacket/omo-tool-fold/master/install.sh | sh
```

스크립트가 이 저장소 `master` 브랜치에서 `extension/tool-fold.ts`와 `themes/grok-day-focus.json`을 받아 `~/.omo/agent/extensions/`와 `~/.omo/agent/themes/`에 넣습니다. 폴더가 없으면 만들고, 파일은 끝까지 다 받은 뒤에 기존 파일과 바꿉니다. 클론한 폴더에서 `.\install.ps1`이나 `sh install.sh`로 실행하면 받지 않고 그 폴더의 파일을 복사합니다. 파일마다 `installed -> <destination>`을 출력합니다. 실행 중인 omo 세션은 다음 유휴 시점에 확장을 읽어 들이며, 바로 적용하려면 `/reload`를 입력하면 됩니다. `settings.json`을 비롯해 다른 파일은 건드리지 않고, 여러 번 실행해도 안전합니다.

Windows에서는 PowerShell 줄을 쓰세요. Git Bash의 curl은 Windows 인증서 저장소를 읽지 않아 인증서 오류(60)로 실패할 수 있습니다.

테마를 쓰려면 `~/.omo/agent/settings.json`에 다음을 넣습니다.

```json
"theme": "grok-day-focus"
```

**업데이트:** 같은 줄을 다시 실행합니다.

**제거:** `~/.omo/agent/extensions/tool-fold.ts`를 지우고 `/reload` 하거나 omo를 다시 시작합니다. reload 때 확장이 디스패치 대상을 비우므로 원래 표시로 돌아갑니다. 이 경로는 테스트로 확인했고 실제 세션에서는 확인하지 않았습니다. 테마를 바꿨다면 `"grok-day"`로 되돌리세요.

## 접히는 도구와 접히지 않는 도구

- **eval:** `eval js ✓ <셀 summary 첫 줄>`. 오류, 취소, 상태를 알 수 없는 셀은 원래 상자를 그대로 보여 줍니다.
- **edit:** `edit <cwd 기준 경로> (+추가/-삭제)`.
- **todo:** 제목 줄만 남깁니다. 예: `todo done: A 확인`. 전체 목록은 `/todo` 명령과 입력창 아래 todo 위젯에서 볼 수 있습니다.
- **다음 27개 도구**는 `<tool> <verb> <target>` 형태로 접힙니다: web_search, webfetch, write, memory, look_at, powershell, bash_output, tool_search, task, task_output, task_send, task_cancel, team_create, team_delete, task_create, task_get, task_list, task_update, create_goal, update_goal, get_goal, lsp_diagnostics, lsp_goto_definition, lsp_find_references, lsp_symbols, lsp_prepare_rename, lsp_rename.
  - verb는 `op`, `action`, `command` 인자가 짧은 한 단어일 때 그 값입니다.
  - target은 `task_summary`, `description`, `summary`, `query`, `url`, `objective`, `goal`, `prompt`, `message`, `command`, `file_path`, `path`, `filePath`, `pattern`, `name`, `task_id`, `to`, `bash_id`, `status`, `reason` 가운데 처음 나오는 인자의 비어 있지 않은 첫 줄입니다. 경로는 cwd 기준으로 줄여 보여 줍니다.

일부러 건드리지 않는 것:

- **read, grep, find, ls.** senpi가 이미 연속 호출을 탐색 한 줄로 묶어 주는데, 이 묶음은 렌더러가 같은 객체인지 확인합니다. 감싸면 묶음이 깨집니다.
- **ask_user_question.** 질문 카드라서 보여야 합니다.
- **renderCall이나 renderResult가 없는 도구.** 원래 짧습니다.
- **위 목록에 없는 모든 도구.** 앞으로 OMO 업데이트로 추가되는 도구를 모르는 채로 접지 않기 위해서입니다.

결과가 오류이면(`result.isError` 또는 렌더 컨텍스트의 `isError`) 원래 전체 출력을 보여 줍니다.

## 테마

`grok-day-focus`는 senpi 내장 `grok-day` 테마를 복사해서 값 네 개만 바꾼 것입니다.

| 토큰 | grok-day | grok-day-focus | 효과 |
|---|---|---|---|
| `userMessageBg` | `#e8e8e8` | `#d6e4ff` | 내 메시지에 파란 기운 |
| `toolPendingBg` | `#e8e8f0` | `#f7f8f9` | 거의 흰색 |
| `toolSuccessBg` | `#e8f0e8` | `#f7f8f9` | 거의 흰색 |
| `customMessageBg` | `#ede7f6` | `#f7f8f9` | 알림 상자 거의 흰색 |

`toolErrorBg`는 그대로라서 오류 상자는 계속 빨갛습니다. 되돌리려면 `~/.omo/agent/settings.json`에서 `"theme": "grok-day"`로 바꿉니다.

## 동작 방식과 안전장치

senpi에는 다른 확장이 만든 도구의 그리기 방식을 바꾸는 공개 API가 없습니다. 그래서 이 확장은 `@code-yeongyu/senpi`에서 가져온 `AgentSession.prototype.getToolDefinition`(TUI가 도구 렌더러를 찾을 때 쓰는 조회 함수)을 감쌉니다. 한 줄은 `@earendil-works/pi-tui`의 `TruncatedText`로 그립니다. 둘 다 내부 구현이며, 동적으로 import하고 존재 여부를 확인한 뒤 씁니다.

안전장치:

- 업데이트 후 둘 중 하나라도 없으면 아무것도 하지 않고 세션 시작 때 경고 한 줄만 띄웁니다: `tool-fold 꺼짐 (<reason>). 도구 표시는 원래대로 보입니다.`
- 렌더 호출은 전부 감싸 두었습니다. 예외가 나거나 데이터 모양이 예상과 다르면 원래 렌더러로 넘깁니다.
- 저장된 도구 결과는 절대 바꾸지 않습니다. 표시만 바꿉니다.
- 원래 렌더러를 부르기 전에 `context.lastComponent`에서 자기 한 줄 컴포넌트를 치웁니다. edit의 원래 `renderResult`가 `lastComponent.detachAll()`을 호출하기 때문에, 이걸 안 하면 Ctrl+O에서 죽습니다.
- `renderShell: "self"`인 도구(edit, memory)는 줄이 맞도록 왼쪽에 한 칸 여백을 줍니다.

재시작 없는 업데이트: 프로토타입 훅은 프로세스당 한 번만 설치되고(`Symbol.for("omo.tool-fold.hook.v2")`), 항상 `globalThis[Symbol.for("omo.tool-fold.impl.v2")]`로 디스패치합니다. 이 값은 파일을 읽어 들일 때마다 새로 바뀝니다. `session_shutdown`의 reason이 `reload`이면 자기 impl을 비웁니다. senpi는 전역 extensions 폴더의 파일이 바뀌면 세션의 다음 유휴 시점에 핫 리로드하고(작업 중인 세션은 기다림), `/reload`로 바로 할 수도 있습니다. 실제로 확인한 결과, 예전 사본을 돌리던 omo 프로세스가 파일 교체 후 새 사본으로 넘어갔고 기존 대화 기록도 접힌 모양으로 다시 그려졌습니다.

## 한계와 테스트한 버전

- senpi 내부 구현에 기대고 있어서 OMO 업데이트로 꺼질 수 있습니다. 그때는 위 경고가 뜨고 원래 표시로 돌아갑니다.
- senpi 테마 파일은 필수 색상 토큰을 전부 정의해야 합니다. OMO 업데이트로 필수 토큰이 늘면 `grok-day-focus`가 로드되지 않을 수 있습니다. 죽지 않고 건너뛸 것으로 보지만 확인하지는 않았습니다. 고치려면 설치된 senpi에서 새 `grok-day.json`을 복사해 값 네 개를 다시 바꾸면 됩니다.

테스트 환경: OMO 바이너리 5.1.12 (npm `omo-ai` 5.1.17, `@code-yeongyu/senpi` 2026.10.8), Windows 11, Bun 1.4.2.

## 개발

```sh
bun test
```

가짜 senpi, pi-tui 모듈(`bun:test`의 `mock.module`)을 상대로 테스트 19개를 돌립니다. 테스트마다 `?case=<random>` 쿼리로 확장을 새로 import합니다. 실제 omo 세션은 쓰지 않습니다. 실제 TUI에서 확인하는 방법은 [CLAUDE.md](CLAUDE.md)에 있습니다.

## 라이선스

MIT. [LICENSE](LICENSE) 참고.
