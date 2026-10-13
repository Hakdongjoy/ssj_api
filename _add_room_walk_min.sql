-- sjj_room 신규 컬럼: 지하철역까지 도보 소요시간
alter table sjj_room add column walk_min integer; -- 분 단위. null이면 미입력

comment on column sjj_room.walk_min is '가장 가까운 지하철역(subway_stn)까지 도보 소요시간 (분). 등록자가 직접 입력';
