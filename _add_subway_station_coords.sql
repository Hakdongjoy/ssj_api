-- 지하철역 좌표 (가까운 역 자동계산용). 1회성 백필 스크립트로 채워질 예정, 당장은 전부 null
alter table sjj_subway_station add column lat double precision;
alter table sjj_subway_station add column lng double precision;

comment on column sjj_subway_station.lat is '역 위도. 카카오 로컬 API로 백필';
comment on column sjj_subway_station.lng is '역 경도. 카카오 로컬 API로 백필';
