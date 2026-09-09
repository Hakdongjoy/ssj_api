# 살짝 API

룸메이트 매칭 앱 "살짝"의 백엔드 API 서버입니다. 이미 방을 구해서 같이 살 사람을 찾는 사람과, 아직 방이 없어서 함께 구할 사람을 찾는 사람을 이어줍니다.

📄 **API 명세서**: [살짝 API Spec](https://claude.ai/code/artifact/2b7e974c-7828-4c6e-9029-e856b791dfac)

## 기술 스택

- **Node.js** + **Express**
- **Supabase** (PostgreSQL, Auth)
- **Render** (배포)

## 프로젝트 구조

```
ssj/
├── index.js              # 서버 진입점
├── supabase.js           # Supabase 클라이언트 설정
├── middleware/
│   └── auth.js           # JWT 토큰 검증 미들웨어
├── routes/
│   ├── auth.js           # 회원가입 / 로그인 / 휴대폰 인증 / 아이디 중복확인
│   ├── user.js           # 닉네임 / 추가정보(방 없는 사람)
│   └── room.js           # 공고 등록(방 있는 사람)
└── utils/
    └── nick.js           # 랜덤 닉네임 생성기
```

## 시작하기

```bash
npm install
```

프로젝트 루트에 `.env` 파일을 만들고 아래 값을 채워주세요.

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PORT=3000
```

```bash
npm start
```

## API 개요

| Method | Endpoint | 인증 | 설명 |
|---|---|---|---|
| GET | `/api/auth/check-id` | - | 아이디 중복 확인 |
| POST | `/api/auth/phone/request` | - | 휴대폰 인증번호 발송 |
| POST | `/api/auth/phone/confirm` | - | 휴대폰 인증번호 확인 |
| POST | `/api/auth/signup` | - | 회원가입 |
| POST | `/api/auth/login` | - | 로그인 |
| GET | `/api/user/nick/random` | - | 랜덤 닉네임 생성 |
| PATCH | `/api/user/nick` | 🔒 | 닉네임 수정 |
| POST | `/api/user/pref` | 🔒 | 추가정보 등록 (방 없는 사람) |
| POST | `/api/room/register` | 🔒 | 공고 등록 (방 있는 사람) |

인증이 필요한 API는 `Authorization: Bearer <access_token>` 헤더가 필요합니다.

자세한 요청/응답 형식은 [API 명세서](https://claude.ai/code/artifact/2b7e974c-7828-4c6e-9029-e856b791dfac)를 참고해주세요.

## DB 구조

- `sjj_user` — 유저 기본 정보
- `sjj_user_info` — 유저 추가정보 (생활습관)
- `sjj_room` — 공고 (방 있는 사람)
- `sjj_room_pref` — 희망조건 (방 없는 사람)
- `sjj_phone_verify` — 휴대폰 본인인증
