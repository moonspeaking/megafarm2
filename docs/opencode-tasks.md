# Задачи для opencode — порт Farm Craft 2 в веб

## Общий контекст (вставлять в каждый запрос)

Проект: `/Users/Apple/PycharmProjects/megafarm2` — браузерный порт **второй части** Farm Craft (Farm Craft 2 Rus, 2009).
Заготовка = копия движка порта первой части (`/Users/Apple/PycharmProjects/megafarm`, читать как образец и справку).
Чистый JS (ES-модули), без сборки и npm. Запуск: `python3 tools/serve.py` → http://localhost:8123/.
Оригинал игры (только читать): `/Users/Apple/Downloads/Farm Craft 2 Rus/` (data/ — уже распакованные текстуры, звуки, скрипты UTF-16;
game.dll/exe — для дизассемблирования, IDA-скрипты первой части лежат в `tools/ida/`).
Ресурсы уже сконвертированы в `assets/` (`tools/prepare_assets.py --source "/Users/Apple/Downloads/Farm Craft 2 Rus" --dest assets`).

Правила:
- Стиль, размеры и поведение брать из скриптов оригинала (`assets/scripts/**`) и дизассемблера, не выдумывать.
  Нет знания → записать вопрос в `docs/open-questions.md`, сделать разумное поведение по умолчанию.
- `assets/` не править руками (только перегенерация tools/). Без зависимостей и сборщиков.
- Каждая задача: свои файлы, после правок прогнать затронутые `tools/test_*.mjs`/`check_*.mjs`, открыть игру в браузере.
  Отчёт: что сделано, проверено, НЕ проверено.

## Что известно о отличиях части 2 от части 1 (разведка уже сделана)
- 24 уровня (`level1..24.txt`), у каждого есть `levelN_entry.txt` (расстановка объектов, события `@event`, `default placement`)
  и `levelN_dialogue.txt` (`@simple_dialogue` / `@simple_dialogue_frame`: лица `face_*.tga`, слайды, фразы по ключу). В части 1 это было одним файлом.
  Файлы начинаются со строки `<<`.
- Холст оригинала **1024x768** (не 800x600), меню карты — `interfaces/levelmenu.txt` (`@ilevelmenu`) вместо `gamemap`/`map_script`.
  Нет `interfaces/gamemap`, `trophyroom`; есть `levelmenu`.
- Новые объекты (`assets/scripts/objects/`): guard, manager, looser, lightbug, bulldozer, constructor, destructor, mobilephone,
  airplane_cockpit/tail, factory_clothes/sausage/sweeties, generator, big_generator, megawaterpump, multibox, fivebox,
  decor_* (altar, bog, lake, oasis, pit, ravine, runningsand, stones, thorns, frozen_*...), fence_* (с lock-вариантами), map_piece, marker, fake_fertilizer, plant_bur.
- Тексты: `rus.txt` и пр. (языки как в части 1), `full_shop.txt`, credits_*.
- Окружения: grass / desert / swamp / jungle / frozen (проверить по `level_env`).

## Статус (обновлено)
- 1 загрузчик — готово. 2 холст 1024×768 и HUD — готово (вручную). 3 levelmenu — готово (opencode), глазами проверен частично.
- 4 инфраструктура — готово по скриптам, дизассемблер не разбирался. 5 охрана (`sim_people.js`) и фабрики (`sim_factory.js`) — готово;
  НЕ сделано: движение менеджера/looser/lightbug, самолёт (airplane_*) — только расстановка.
- 6 диалоги (`ui.js`), цели на доске (`goals.js`), `end dialogue` — готово; визуальные эффекты (`visual effect`, `effect show`) — только счётчики.
- 7 графика — частично: альфа-каналы из хвостов .jpg восстановлены (`tools/extract_jpg_alpha.py`), не проверены: все окружения, фабрики, анимации людей.
- 8 тесты — адаптированы, все `tools/test_*.mjs`/`check_*.mjs` зелёные, кроме `check_manifest.mjs` (литералы текстур первой части в `menu.js`/`render.js`:
  — исправлено: сейчас зелёный).
- Меню (главное, настройки, пауза, титры) и загрузчик переведены на 1024×768 по `interfaces/menu|credits|loader.txt`.
- Открыто: заставка `intro`, окна помощи/выбора игрока/громкости на 1024 не сверялись с скриптами;
  победа/поражение по времени уровня; игра пока не пройдена ни одним уровнем в браузере.

## Статус заготовки (исходный, до задачи 1)
`node tools/check_levels.mjs` падает на всех 24 уровнях («нет действия victory»): `src/data.js` ищет `level(\d+)` и `map_script`,
не знает про `_entry`/`_dialogue`/`levelmenu`. Это задача 1.

---

## Задача 1. Загрузчик данных части 2 (data.js, assets.js, dsl.js)
Файлы: `src/data.js`, `src/assets.js`, `src/dsl.js`, `tools/test_dsl.mjs`, `tools/check_levels.mjs`.
Сделать: грузить `levelN` + `levelN_entry` + `levelN_dialogue` и сливать в один узел уровня; список INTERFACE_SCRIPTS заменить
(`levelmenu` вместо `gamemap`/`trophyroom`, `map_script` убрать); `@simple_dialogue` индексировать по `name`; учесть префикс `<<`.
Убедиться, что парсер DSL разбирает **все** 291 скрипт без ошибок (`test_dsl.mjs`). Обновить `check_levels.mjs` на 24 уровня и новые типы действий/условий
(собрать полный список `#string type` из `@action`/`@condition` всех уровней в `docs/part2-script-types.md`: тип → сколько раз → понимает ли sim.js).
Готово: `check_levels.mjs` не ругается на структуру (могут остаться «неизвестный тип действия» — они и есть список для задач 4–6).

## Задача 2. Холст 1024x768 и интерфейсы
Файлы: `index.html`, `styles.css`, `src/main.js`, `src/ui.js`, `src/render.js`.
Перевести логический холст с 800x600 на 1024x768, масштабирование по окну сохранить. Сверить HUD с `interfaces/gameplay.txt`
(позиции, шрифты, панели, цели, магазин внизу). Заставка/загрузчик/меню — `intro/loader/menu.txt`. Таблица «элемент → скрипт → совпадает/исправлено».
Зависит от задачи 1.

## Задача 3. Меню выбора уровня (levelmenu) вместо карты
Файлы: `src/menu.js`, `src/progress.js`, `styles.css`.
Реализовать экран по `interfaces/levelmenu.txt` (24 уровня, трофеи `trophy1..`, кнопки, подсказки, фигурка), прогресс/рекорды на 24 уровня.
Комиксы — `interfaces/comics.txt`, страницы `gamecomics/comicspage1..25.jpg`; сверить `src/comics.js`. Профили/настройки из части 1 оставить.
Зависит от задачи 1.

## Задача 4. Симуляция: новые объекты и действия, группа A (инфраструктура)
Файлы: `src/sim.js` (+ новые модули `src/sim_*.js`, как `sim_bees.js`), `src/render.js`.
Объекты: decor_* (препятствия/зоны: болото, озеро, песок, шипы…), fence_* (в т.ч. lock-варианты, открытие), bulldozer / constructor / destructor,
generator / big_generator / megawaterpump, multibox/fivebox, fake_fertilizer, plant_bur, map_piece. Поведение — по скриптам объектов и дизассемблеру
(`Game.dll`; методы находить по строкам имён). Каждый — в `docs/original-notes.md` (раздел «Часть 2»).
Готово: уровни 1–8 проходят `smoke_levels.mjs` без ошибок, новые типы из списка (задача 1) закрыты или записаны в open-questions.

## Задача 5. Симуляция: персонажи и фабрики, группа B
Файлы: новые `src/sim_workers.js`, `src/sim_factories.js`, правки `src/sim.js`/`render.js`.
guard, manager, looser, lightbug, mobilephone, helper/harvester/herder/waterboy (отличия от части 1), factory_clothes/sausage/sweeties
(цепочки производства, ремонт — звуки `factory_*`), airplane_* (финальные уровни). Анимации — `assets/textures/animations/**`.
Готово: уровни 9–24 в `smoke_levels.mjs` без ошибок, фабрики производят и продают по скриптам.

## Задача 6. Сценарии, диалоги, события 1–24
Файлы: `src/sim.js` (runAction/условия — вынести в `src/scenario.js`), `src/ui.js`, `src/goals.js`, `src/endsound.js`.
Все типы `@action`/`@condition` из `docs/part2-script-types.md`; диалоги `simple_dialogue` с лицами и слайдами, подсказки (`add particles`),
цели задания (`player_task`), условия победы/поражения, звук конца уровня. Готово: `check_levels.mjs` чисто на 24 уровнях.

## Задача 7. Графика окружений и спрайтов
Файлы: `tools/prepare_assets.py`, `tools/extract_*.py`, `src/assets.js`, `src/render.js`.
Проверить прозрачность/ключи цвета спрайтов части 2 (анимации животных, людей, фабрик, декор `decor.jpg`-аналоги, кромки грядок для desert/swamp/…),
перегенерировать при необходимости; `check_manifest.mjs` чисто. Скриншоты до/после — в /tmp.

## Задача 8. Тесты и регресс
Файлы: `tools/test_*.mjs`, `tools/smoke_levels.mjs`, `tools/bench_sim.mjs`.
Адаптировать все тесты первой части (12 уровней → 24, уровень 1 по-новому), `test_savegame_all.mjs` на 24 уровня; README обновить.
Выполнять последней.

## Порядок
1 → (2, 3, 4 параллельно, файлы не пересекаются кроме render.js: 2 и 4 — последовательно) → 5 → 6 → 7 → 8.
