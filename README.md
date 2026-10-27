🏠 살짝 API

룸메이트 매칭 앱 "살짝"의 백엔드 API 서버입니다 💚 이미 방을 구해서 같이 살 사람을 찾는 사람과, 아직 방이 없어서 함께 구할 사람을 찾는 사람을 이어줍니다.

## 🔗 링크

- 📱 **살짝 서비스**: [https://twin-psi-murex.vercel.app](https://twin-psi-murex.vercel.app)
- 🌐 **API 서버**: [https://ssj-api.onrender.com](https://ssj-api.onrender.com)
- 📄 **API 명세서**: [살짝 API Spec](https://claude.ai/code/artifact/2b7e974c-7828-4c6e-9029-e856b791dfac)

## 🛠️ 기술 스택

- 🟢 **Node.js** + **Express**
- ⚡ **Supabase** (PostgreSQL, Auth)
- 🚀 **Render** (배포)

## 📁 프로젝트 구조

```
ssj/
├── index.js              # 서버 진입점
├── supabase.js           # Supabase 클라이언트 설정
├── middleware/
│   └── auth.js           # JWT 토큰 검증 미들웨어
├── routes/
│   ├── auth.js           # 회원가입 / 로그인 / SNS 로그인 / 휴대폰 인증 / 아이디 중복확인
│   ├── user.js           # 닉네임 / 추가정보(방 없는 사람)
│   ├── room.js           # 공고 등록·목록·상세·신청(방 있는 사람)
│   └── chat.js           # 매칭 수락 후 채팅
└── utils/
    └── nick.js           # 랜덤 닉네임 생성기
```

## 📡 API 개요

| Method | Endpoint | 인증 | 설명 |
|---|---|---|---|
| GET | `/api/auth/check-id` | - | 아이디 중복 확인 |
| POST | `/api/auth/phone/request` | - | 휴대폰 인증번호 발송 |
| POST | `/api/auth/phone/confirm` | - | 휴대폰 인증번호 확인 |
| POST | `/api/auth/signup` | - | 회원가입 |
| POST | `/api/auth/login` | - | 로그인 |
| POST | `/api/auth/refresh` | - | access_token 재발급 (refresh_token 사용) |
| POST | `/api/auth/social/complete` | 🔒 | SNS(카카오) 로그인 후 프로필 완성 확인 |
| GET | `/api/user/nick/random` | - | 랜덤 닉네임 생성 |
| PATCH | `/api/user/nick` | 🔒 | 닉네임 수정 |
| POST | `/api/user/pref` | 🔒 | 추가정보 등록 (방 없는 사람) |
| DELETE | `/api/user/me` | 🔒 | 회원 탈퇴 (소프트 삭제/익명화) |
| POST | `/api/room/register` | 🔒 | 공고 등록 |
| PATCH | `/api/room/:id` | 🔒 | 공고 수정 (매칭 완료 전까지만) |
| POST | `/api/room/:id/photos` | 🔒 | 공고 사진 추가 (카테고리: 거실/방/주방/화장실/현관/기타) |
| DELETE | `/api/room/:id/photos/:photoId` | 🔒 | 공고 사진 삭제 |
| GET | `/api/room/region_cnt` | - | 광역/시군구별 공고 개수 (지역선택용) |
| GET | `/api/room/station-search` | - | 역 검색 자동완성 |
| GET | `/api/room/address-search` | - | 주소 입력 시 가까운 지하철역 + 도보시간 자동계산 (단일 결과, 카카오 로컬 API) |
| GET | `/api/room/list` | - | 공고 목록 (무한스크롤, 최초 7개) |
| GET | `/api/room/count` | - | 필터 적용 시 결과 개수만 조회 (필터 모달 미리보기용) |
| GET | `/api/room/:id` | - | 공고 상세 |
| POST | `/api/room/:id/inquire` | 🔒 | 문의하기 (채팅방 열기) |
| POST | `/api/room/:id/apply` | 🔒 | 함께 살기로 요청 (채팅방 안에서 호출) |
| GET | `/api/room/applications/received` | 🔒 | 내가 받은 신청 목록 |
| GET | `/api/room/applications/sent` | 🔒 | 내가 보낸 신청 목록 |
| PATCH | `/api/room/applications/:applyId` | 🔒 | 신청 수락/거절 |
| GET | `/api/chat/rooms` | 🔒 | 내 채팅방 목록 |
| GET | `/api/chat/rooms/:chatRoomId/messages` | 🔒 | 메시지 조회 (폴링) |
| POST | `/api/chat/rooms/:chatRoomId/messages` | 🔒 | 메시지 전송 |
| GET | `/api/admin/users` | 🔒👑 | 유저 검색/목록 |
| PATCH | `/api/admin/users/:id/ban` | 🔒👑 | 유저 정지 |
| PATCH | `/api/admin/users/:id/unban` | 🔒👑 | 유저 정지 해제 |
| GET | `/api/admin/rooms` | 🔒👑 | 공고 전체 조회 (비활성 포함) |
| PATCH | `/api/admin/rooms/:id/deactivate` | 🔒👑 | 공고 강제 비활성화 |
| GET | `/api/admin/stats` | 🔒👑 | 전체 현황 요약 |

🔒 표시된 API는 `Authorization: Bearer <access_token>` 헤더가 필요해요. 👑는 `sjj_user.is_admin=true`인 관리자 계정만 가능해요.

자세한 요청/응답 형식은 📄 [API 명세서](https://claude.ai/code/artifact/2b7e974c-7828-4c6e-9029-e856b791dfac)를 참고해주세요.

## 🔑 환경변수

| 변수 | 용도 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 연결 |
| `PORT` | 서버 포트 |
| `KAKAO_REST_API_KEY` | 가까운역·도보시간 자동계산(`/room/address-search`)용 카카오 로컬 API 키 |

## 🗄️ DB 구조

- 👤 `sjj_user` — 유저 기본 정보 (deleted_at으로 탈퇴 여부 표시, 탈퇴해도 행은 익명화해서 유지)
- 📋 `sjj_user_info` — 유저 추가정보 (생활습관)
- 🏘️ `sjj_room` — 공고 (방 있는 사람)
- 🔍 `sjj_room_pref` — 희망조건 (방 없는 사람)
- 📞 `sjj_phone_verify` — 휴대폰 본인인증
- 🗺️ `sjj_region` / `sjj_district` — 광역/시군구 마스터
- 🚇 `sjj_subway_station` — 지하철 역-호선 마스터 (서울/경기/인천 등 세분화된 지역 포함, lat/lng 좌표 99.5% 백필 완료)
- 🤝 `sjj_room_apply` — 살짝 신청 (매칭 신청/수락/거절)
- 💬 `sjj_chat_room` / `sjj_chat_message` — 매칭 수락 후 채팅
- 🖼️ `sjj_room_photo` — 공고 사진 URL (Supabase Storage `room-photos` 버킷)
