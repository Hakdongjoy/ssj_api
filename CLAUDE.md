# CLAUDE.md — 살짝(ssj) 백엔드

룸메이트 매칭 앱 "살짝"의 API 서버. Node.js + Express + Supabase(Postgres/Auth), Render 배포, 프론트는 Vercel.

## 프로젝트 구조
```
ssj/
├── index.js              # 서버 진입점 (/api/auth, /api/user, /api/room, /api/chat 마운트)
├── supabase.js           # supabaseAdmin (service role 클라이언트) export
├── middleware/auth.js    # verifyToken(필수 인증), optionalAuth(선택 인증)
├── routes/
│   ├── auth.js           # 회원가입/로그인/SNS/휴대폰인증
│   ├── user.js           # 닉네임, 추가정보(방 없는 사람), 회원탈퇴
│   ├── room.js           # 공고 등록·목록·상세·필터·신청·채팅연결
│   └── chat.js           # 채팅 메시지
```

DB 마이그레이션 `_*.sql` 파일은 `C:\claude\ssj_sql\`에 보관 (레포 밖, 1회성이어도 실행 후 삭제하지 않음).

- 📄 API 명세서(Artifact): https://claude.ai/code/artifact/2b7e974c-7828-4c6e-9029-e856b791dfac
- 코드/기능 변경 시 README.md + 위 명세서를 같이 갱신 (버전 bump 포함)

## 절대 규칙

**DDL은 절대 직접 실행할 수 없다.** `SUPABASE_SERVICE_ROLE_KEY`는 PostgREST REST API용 키라 `alter table`/`create table` 같은 DDL을 지원하지 않는다 (`supabase.rpc()`로 임의 SQL 실행도 불가 — 등록된 함수가 없음). 스키마 변경이 필요하면 `C:\claude\ssj_sql\_설명.sql` 파일을 작성(`alter table ... add column`, `comment on column ...` 패턴)하고, **사용자가 Supabase SQL Editor에서 직접 실행할 때까지 그 컬럼을 쓰는 코드를 "완료"로 보고하지 않는다.**

**`auth.users` → `sjj_user`는 cascade 삭제 관계다.** `supabaseAdmin.auth.admin.deleteUser(user_id)`를 호출하면 `sjj_user` 행이 통째로 같이 사라진다 (회원탈퇴 기능 구현 중 실제로 발견한 버그). 계정 로그인만 막고 행은 보존해야 하는 작업(탈퇴, 정지 등)은 `deleteUser` 대신 `auth.admin.updateUserById(user_id, { ban_duration: '876000h' })`(사실상 영구 정지)를 쓴다.

**에러 응답 포맷은 항상 동일**: `{ code: 'XXX_YYY', error: '사용자가 봐도 되는 완성된 한글 문장' }`. `code`는 SCREAMING_SNAKE_CASE, `error`는 내부 필드명·Supabase/Postgres 원문을 노출하지 않는 일반 문구 (원본 에러는 `console.error`로만). 이 정책은 400 에러에 한해 프론트가 그대로 화면에 노출하기로 합의된 것 — 500은 아직 대상 아님.

**신규 필드는 스크린샷/요구사항에서 추정만 하지 말고, 필드명·타입·enum 값·필수여부를 정리해서 먼저 확인받는다.** 추측으로 바로 구현하지 않는다.

## 코드 컨벤션

- 전부 한글 주석, DB 컬럼명은 snake_case, JS 변수명은 camelCase.
- `supabaseAdmin`(service role, RLS 우회)만 사용 — anon 클라이언트 없음.
- 인증 미들웨어는 `verifyToken`(필수), `optionalAuth`(있으면 req.user 채우고 없어도 통과) 둘뿐.
- `room.js`의 `applyRoomFilters(query, qp)`가 `GET /room/list`와 `GET /room/count`의 필터 로직을 공유한다. 새 필터 조건을 추가할 땐 이 함수 하나만 고치면 양쪽에 다 반영됨 — 각각 따로 구현하지 않는다.
- v3.7.0 리뉴얼로 생활조건(흡연/음주/반려동물 등)이 `sjj_user_info`(유저 전역)에서 `sjj_room`(공고 단위) 컬럼으로 이동했다. 신규 생활조건류 필드는 기본적으로 공고 단위로 설계하되, 유저 전역 vs 공고 단위가 애매하면 반드시 질문한다.
- `resolveShareTotal(room)` 패턴: 새 방식(`share_percent`)이 있으면 그걸로 계산, 없으면 구버전(`share_rent_type` 등)으로 폴백. 필드를 완전 교체하는 변경에서도 기존 데이터가 깨지지 않도록 이런 폴백을 우선 고려한다.
- 신청→채팅 플로우(v3.8.0 이후): "문의하기"(`POST /room/:id/inquire`)로 채팅방을 먼저 만들고(호스트 명의 고정 인사말 자동삽입) → 그 채팅방 안에서 "함께 살기로 요청"(`POST /room/:id/apply`)을 호출해 `sjj_room_apply` 생성 + 기존 채팅방에 연결 → 수락(`PATCH /room/applications/:applyId`)은 채팅방을 새로 만들지 않고 기존 걸 찾아서 반환. 이 플로우를 건드릴 땐 "채팅방이 이미 있을 수 있다"를 전제로 find-or-create 패턴을 쓴다.

## 검증 방법 (코드만 보고 끝내지 않고 반드시 실제로 호출해서 확인)

1. `node --check routes/xxx.js`로 문법 확인
2. 로컬 서버 기동: `netstat -ano | grep :3000`으로 기존 프로세스 확인 후 필요시 정리, `node index.js`로 띄움(포트 3000)
3. 테스트 데이터는 `POST /api/auth/signup`으로 실제 토큰 발급받거나 `supabaseAdmin`으로 직접 행 insert해서 준비
4. 실제 HTTP 호출(curl 또는 node fetch)로 검증. **한글 쿼리파라미터를 curl로 보내면 git-bash에서 인코딩이 깨질 수 있다** — URL 인코딩하거나 node fetch를 쓴다
5. **테스트 끝나면 만든 데이터를 반드시 정리**(`sjj_room`, `sjj_chat_room`, `sjj_room_apply`, 테스트 계정(`auth.admin.deleteUser`) 등). 정리 후 `GET /room/count` 등으로 원래 총량이 돌아왔는지 재확인
6. 가능하면 production(`https://ssj-api.onrender.com`)에서도 동일하게 실제 호출로 검증 — 배포가 실제로 반영됐는지 확인하는 목적도 겸함

## 작업 완료 시 체크리스트

1. 코드 구현 + 로컬/프로덕션 실제 호출 검증 + 테스트 데이터 정리
2. git commit (한글, "왜"를 설명하는 메시지) + push
3. README.md 갱신 (엔드포인트 표, DB 구조 목록)
4. API 명세서(Artifact) 갱신 — 버전 bump, 영향받은 섹션(Request Body, Response Example, 사이드바, DB 테이블 문서) 전부 반영
