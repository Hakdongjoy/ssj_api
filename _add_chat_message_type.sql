-- 신청/수락/거절 시 채팅방에 자동으로 남기는 시스템 로그 메시지를 구분하기 위한 컬럼
alter table sjj_chat_message add column type text not null default 'text';

comment on column sjj_chat_message.type is '메시지 종류. text(일반 메시지) | system(자동 삽입된 시스템 로그 — 신청/수락/거절 등, 말풍선 없이 표시)';
