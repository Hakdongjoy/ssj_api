alter table sjj_user add column deleted_at timestamptz;
comment on column sjj_user.deleted_at is '회원 탈퇴 일시. null이면 활성 계정';
