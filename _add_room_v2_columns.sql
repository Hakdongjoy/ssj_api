-- sjj_room 신규 컬럼
alter table sjj_room add column house_type text;                    -- 원룸 | 투룸 | 그이상 | null
alter table sjj_room add column deposit integer;                    -- 보증금 (만원)
alter table sjj_room add column recruit_count integer default 1;    -- 모집인원
alter table sjj_room add column move_in_type text;                  -- immediate | this_month | negotiate
alter table sjj_room add column utility_separate boolean default false; -- 공과금 별도 여부
alter table sjj_room add column furniture_included boolean default false; -- 기본가구 여부
alter table sjj_room add column private_room_count integer;         -- 개인 침실 개수
alter table sjj_room add column clean_level text;                   -- 깨끗한편 | 보통 | 상관없음
alter table sjj_room add column photo_public boolean default true;  -- 사진 공개 여부

comment on column sjj_room.house_type is '집 구조. 원룸/투룸/그이상, null이면 미표기';
comment on column sjj_room.deposit is '보증금 (만원 단위)';
comment on column sjj_room.recruit_count is '모집 인원';
comment on column sjj_room.move_in_type is '입주 가능 시기. immediate(즉시)/this_month(이번달)/negotiate(일정은 대화로)';
comment on column sjj_room.utility_separate is '공과금(전기/수도/가스) 관리비와 별도 부담 여부';
comment on column sjj_room.furniture_included is '기본 가구 포함 여부';
comment on column sjj_room.private_room_count is '살짝이 쓰게 될 개인 침실 개수';
comment on column sjj_room.clean_level is '청결도 자기평가. 깨끗한편/보통/상관없음 (청소빈도 clean_freq와는 별개)';
comment on column sjj_room.photo_public is '사진 공개 여부. false면 응답에서 photos 비움';

-- 공고 사진
create table sjj_room_photo (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references sjj_room(id),
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_room_photo_room on sjj_room_photo (room_id);
comment on table sjj_room_photo is '공고 사진 URL 목록 (Supabase Storage room-photos 버킷에 업로드된 결과물)';
