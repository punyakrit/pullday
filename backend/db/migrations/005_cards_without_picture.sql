-- Cards whose image_url is gone: their source answered 404 on 24 November 2026, all 27 of them, and every
-- other one gave a picture. They stay in the catalogue, but are the last to be a reward or in a challenge.
create table cards_without_picture (
  card_id text primary key references cards
);

insert into cards_without_picture (card_id) values
  ('c_0043'), ('c_0049'), ('c_0063'), ('c_0151'), ('c_0158'), ('c_0274'), ('c_0375'),
  ('c_0478'), ('c_0517'), ('c_0567'), ('c_0568'), ('c_0614'), ('c_0656'), ('c_0824'),
  ('c_0865'), ('c_0867'), ('c_0901'), ('c_0939'), ('c_1191'), ('c_1233'), ('c_1266'),
  ('c_1302'), ('c_1326'), ('c_1411'), ('c_1483'), ('c_1534'), ('c_1545');
