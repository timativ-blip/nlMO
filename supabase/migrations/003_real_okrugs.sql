-- 12 одномандатных избирательных округов вместо демо-округов
delete from reports where id like 'r\_%' and data->>'conclusions' = '';
delete from districts where id !~ '^1[12][0-9]$';
insert into districts (id, data) values
('118', '{"id":"118","num":118,"name":"Балашихинский","cities":["Балашиха","Реутов"],"coordinatorName":null,"coordinatorId":null}'::jsonb),
('119', '{"id":"119","num":119,"name":"Дмитровский","cities":["Дмитров","Лобня","Солнечногорск","Химки"],"coordinatorName":"Чжан Арсений","coordinatorId":null}'::jsonb),
('120', '{"id":"120","num":120,"name":"Коломенский","cities":["Воскресенск","Зарайск","Кашира","Коломна","Луховицы","пос. Серебряные Пруды"],"coordinatorName":"Филатов Олег","coordinatorId":null}'::jsonb),
('121', '{"id":"121","num":121,"name":"Красногорский","cities":["Волоколамск","Истра","Клин","Красногорск","пос. Восход","пос. Лотошино","пос. Шаховская"],"coordinatorName":"Блюдин Алексей","coordinatorId":null}'::jsonb),
('122', '{"id":"122","num":122,"name":"Люберецкий","cities":["Видное","Жуковский","Котельники","Люберцы","Раменское"],"coordinatorName":"Мустафин Камиль","coordinatorId":null}'::jsonb),
('123', '{"id":"123","num":123,"name":"Мытищинский","cities":["Долгопрудный","Королев","Мытищи"],"coordinatorName":"Синицына Наталья","coordinatorId":null}'::jsonb),
('124', '{"id":"124","num":124,"name":"Одинцовский","cities":["Краснознаменск","Можайск","Наро-Фоминск","Одинцово","Руза","пос. Власиха","пос. Молодёжный"],"coordinatorName":"Жуковский Михаил","coordinatorId":null}'::jsonb),
('125', '{"id":"125","num":125,"name":"Орехово-Зуевский","cities":["Егорьевск","Орехово-Зуево","Павловский Посад","Шатура","Электросталь"],"coordinatorName":"Наумова Полина","coordinatorId":null}'::jsonb),
('126', '{"id":"126","num":126,"name":"Подольский","cities":["Домодедово","Лыткарино","Подольск"],"coordinatorName":"Диана Образцова","coordinatorId":null}'::jsonb),
('127', '{"id":"127","num":127,"name":"Сергиево-Посадский","cities":["Дубна","Пушкино","Сергиев Посад","Талдом"],"coordinatorName":"Кемалов Самир","coordinatorId":null}'::jsonb),
('128', '{"id":"128","num":128,"name":"Серпуховский","cities":["Бронницы","Серпухов","Ступино","Чехов"],"coordinatorName":"Михеева Диана","coordinatorId":null}'::jsonb),
('129', '{"id":"129","num":129,"name":"Щёлковский","cities":["Лосино-Петровский","Ногинск","Фрязино","Черноголовка","Щелково","пос. Звёздный городок"],"coordinatorName":"Писмаркина Анастасия","coordinatorId":null}'::jsonb)
on conflict (id) do update set data = excluded.data;
