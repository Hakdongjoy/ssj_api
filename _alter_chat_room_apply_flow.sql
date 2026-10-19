-- 신청→채팅 플로우 변경: 채팅이 신청(수락)의 결과물이 아니라 신청의 전제조건이 되도록 구조 변경
-- "문의하기"로 먼저 채팅방을 만들고, 그 안에서 "함께 살기로 요청"을 누르면 신청(sjj_room_apply)이 생성됨

-- apply_id를 nullable로: 아직 신청 전(문의만 한) 채팅방은 apply_id가 없음
alter table sjj_chat_room alter column apply_id drop not null;

-- 같은 공고에 같은 신청자가 "문의하기"를 여러 번 눌러도 채팅방이 중복 생성되지 않도록
alter table sjj_chat_room add constraint sjj_chat_room_room_applicant_unique unique (room_id, applicant_id);

comment on column sjj_chat_room.apply_id is 'sjj_room_apply.id 참조. 문의만 하고 아직 신청("함께 살기로 요청") 안 했으면 null';
