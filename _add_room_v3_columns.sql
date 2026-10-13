-- sjj_room 신규 컬럼 (공고등록 리뉴얼 — 9_register_new_* 스크린샷 기준)

alter table sjj_room add column title text; -- 공고 제목

alter table sjj_room add column house_type_input text; -- house_type="기타"일 때 직접입력값

-- 함께 쓰는 공간 (다중선택)
alter table sjj_room add column shared_spaces text[]; -- 예: {거실,주방,화장실,베란다}

-- 비용 분담: 기존 share_rent_type/amount, share_maint_type/amount를 대체하는 단일 퍼센트
alter table sjj_room add column share_percent integer; -- 살짝이 부담하는 비율(0~100). (월세+관리비) 또는 월세만 기준은 utility_separate로 결정

-- 생활조건 (공고 단위로 저장 — 기존처럼 sjj_user_info 전역이 아니라 공고마다 다르게 설정 가능)
alter table sjj_room add column smoking_policy text; -- 비흡연 | 실내금연 | 흡연가능
alter table sjj_room add column drink_freq text; -- 안마심 | 가끔 | 자주 (기존 sjj_user_info.drink_freq에서 공고 단위로 이전)
alter table sjj_room add column pet_policy text; -- 반려동물 없음 | 키우고 있어요 | 함께해도 좋아요
alter table sjj_room add column activity_time text; -- 아침형 | 저녁형 | 자유로운 편
alter table sjj_room add column clean_importance text; -- 매우 중요해요 | 중요한 편이에요 | 편하게 지내요
alter table sjj_room add column noise_lifestyle text; -- 조용한 생활 | 일반적인 생활 | 소음 괜찮아요

-- 원하는 동거인 (신규 섹션)
alter table sjj_room add column pref_age_range text; -- 20 | 30 | 40 | null(상관없음)
alter table sjj_room add column pref_job text; -- 직장인 | 학생 | 프리랜서 | null(직업무관)
alter table sjj_room add column pref_tags text[]; -- "이런 분이면 좋겠어요" 해시태그 (제안칩 + 직접추가 혼합)

-- 위치 세분화
alter table sjj_room add column dong text; -- 동네(행정동). 매칭 전에도 공개됨 (district까지만 공개 정책과 별개로 동 단위까지는 노출)
alter table sjj_room add column road_address text; -- 도로명주소. 매칭 전까지 비공개
alter table sjj_room add column detail_address text; -- 상세주소(동호수 등). 매칭 전까지 비공개

comment on column sjj_room.title is '공고 제목';
comment on column sjj_room.house_type_input is 'house_type="기타"일 때 직접입력값';
comment on column sjj_room.shared_spaces is '함께 쓰는 공간 다중선택. 거실/주방/화장실/베란다';
comment on column sjj_room.share_percent is '살짝이 부담하는 비율(0~100). 기존 share_rent_type/amount, share_maint_type/amount 체계를 대체';
comment on column sjj_room.smoking_policy is '집에서의 흡연 정책. 비흡연/실내금연/흡연가능';
comment on column sjj_room.drink_freq is '등록자 음주빈도 (공고 단위). 안마심/가끔/자주';
comment on column sjj_room.pet_policy is '반려동물 정책. 반려동물 없음/키우고 있어요/함께해도 좋아요';
comment on column sjj_room.activity_time is '활동시간대. 아침형/저녁형/자유로운 편';
comment on column sjj_room.clean_importance is '청결 중요도. 매우 중요해요/중요한 편이에요/편하게 지내요';
comment on column sjj_room.noise_lifestyle is '소음/생활소리 성향. 조용한 생활/일반적인 생활/소음 괜찮아요';
comment on column sjj_room.pref_age_range is '원하는 동거인 연령대. 20/30/40, null이면 상관없음';
comment on column sjj_room.pref_job is '원하는 동거인 직업. 직장인/학생/프리랜서, null이면 직업무관';
comment on column sjj_room.pref_tags is '"이런 분이면 좋겠어요" 해시태그 배열 (제안칩 선택 + 직접추가 혼합)';
comment on column sjj_room.dong is '동네(행정동명)';
comment on column sjj_room.road_address is '도로명주소. 매칭 전까지 비공개';
comment on column sjj_room.detail_address is '상세주소(동호수 등). 매칭 전까지 비공개';

-- 참고: deposit 컬럼은 남겨두되(이번 등록 플로우에서 입력 안 받음), house_type 값 체계가
-- 원룸/투룸/그이상 -> 원룸/투룸/쓰리룸 이상/기타로 바뀜 (텍스트 컬럼이라 DDL 변경 불필요, 코드/문서만 반영)
-- share_rent_type/share_rent_amount/share_maint_type/share_maint_amount, avoid_smoke/avoid_drink/avoid_pet,
-- clean_level 컬럼은 기존 데이터 호환을 위해 그대로 두고 더 이상 신규 등록에 쓰지 않음
