-- Deepgram final에 화자 정보가 없어도 전사는 보존하고 화자 기반 분석에서만 제외한다.

alter table utterances
  alter column speaker_label drop not null;
