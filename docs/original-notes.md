# What the original executable does (recovered with IDA / Hex-Rays)

Binary: `farm m.exe` (x86 PE, ~490 KB). Function names below are IDA's `sub_XXXXXX`.
`dt` in the original is `flt_482CB0` and is in **milliseconds**.

## Plants (`sub_41F2A0` update, `sub_41FAE0` init, `sub_41FB90` after harvest, `sub_41FCE0` fertilize)

All meters are 0..100 and advance once per second (level "tick" default 1000 ms).

* init: `health = start_health/100 * plant_starting_health` (level default **50**), dry = growth = fruit = 0.
* each tick
  * `dry += thirsty/100 * plant_thirst_growth` (level default **0.5**); ≥66 counts as *thirsty*.
  * growth phase: `growth += growth/100 * plant_growth(10) * (100-dry)/100`; at 100 the plant becomes mature.
  * fruit phase: `fruit += harvest/100 * plant_fruit_growth(10) * health/100`; at 100 the plant is **ready**
    (one fruit per cycle, not several).
  * fertilizer (only while in fruit phase): `health += shit_strength/100 * plant_fertilizer_strength(1)` per tick for
    `shit_time/100 * plant_fertilizer_time(10)` ticks. A weak fertilizer only works while `health < 60`.
  * if `dry == 100`: `health -= thirst_death/100 * health_reduction_when_thirsty(0.25)`, floor `plant_minimal_health` (0);
    `health == 0` while dry kills the plant.
* picking (`sub_41FB90`): ready/fruit reset; `complete_harvest` -> growth restarts from 0, otherwise it regrows fruit only;
  `health -= harvest_damage/100 * health_reduction_after_harvest(2)`.
* watering sets `dry = 0`.
* sprite stages: growth>10 → 1, >90 → 2, fruit>50 → 3, ready → 4 (`plant_growthN` once, then `plant_idleN`).

## Scenario counters (`sub_411160` names, `sub_4187F0` inc, `sub_4189F0` dec, `sub_4117F0` recheck)

Names come from the string table `0x46139C..0x4614E0`; prefix `<pref>_<name>` resolves `<name>` to an object id via
the object DB (`sub_428980`). `fired` (cond+148) is a **latch**: once the comparison passes it stays 1 (never reset);
actions check `fired == any_condition` per ref (AND when the flag is 0, OR when 1 — `any_condition` is unused in the
shipped scripts). Counters (global src 0 fields 2..10, per-id arrays src 1..6) are event counters:

| counter | event |
| --- | --- |
| `thirsty_plants` | inc when thirst crosses 66 **up** (no dec — cumulative) |
| `sick_plants` | inc health crosses 10 **down**, dec crosses 10 **up** (live count; harvest damage counts) |
| `maxhealth_<id>` | inc health reaches 100, dec when thirst hits 100 while health ≥ 100 (live count; `maxhealth_plant_*` only in scripts) |
| `fruits_ready` | inc when a **plant** fruit finishes growing (0x41F2A0) — **trees do not count** (0x4223C0 fires no counter) |
| `goods_ready` | inc when a house completes a production cycle (flag 9996 guards double-fire until collected) |
| `house_fed` | inc per feeding (action 14) |
| `fields_dug` | inc per dug square (0x413650) |
| `plants_watered` | inc per watering |
| `sow_/sell_/dead_/place_` | inc per sowing / hangar sale / death **or destructor kill** (0x41A170) / placement |
| `buy_` | never incremented (dead feature) |
| `worker_coin`, `worker_question` | one-shot (inc only from 0) |

Port: cumulative counters via `bump()` (`src/sim.js`), live counts only where the original maintains inc/dec pairs.
Tree ripening does not bump `fruits_ready` (deliberate, matches 0x4223C0).

## Boxes
`sub_41A060(box, n)` adds `n` items if the box is not full. A plant gives **1** item and sets the box capacity to the plant's
`max_count_fruit`; houses, trees and beehives give **4** (a full box) and use capacity 4.

## Animal houses (`sub_41D510`, `sub_41D970`, `sub_41DAE0`)
* feeding needs a **full box** of the right fodder category; the box is consumed and food becomes 100.
* food drains `100/time_feed` % per second all the time; production advances `100/time_complete` % per second only while food > 0.
* a finished batch gives a full box (4 items) of the product.

## Trees (`sub_4223C0`, `sub_4227C0`)
Every tick `progress += harvest/100 * plant_fruit_growth(10)` (apple ≈ 34 s, plum 50 s, cherry 71 s, palm 133 s);
at 100 the tree is ready; picking gives a full box (4 items).

## Sprinkler (`sub_423D00`)
Every `sprinkle_frequency` ms (2000) it lowers `dry` of plants inside the ellipse (`sprinkle_radius`, in tiles) by
`sprinkle_strength` (3). It does not reset it.

## Beehive and bees (`CBeehive`, `CBeeAI` -> `sub_418E70` / `sub_404EF0`)
* Bees (`num_bees`, speed 100) fly to the nearest **ripe** flower: a plant whose `type_fruit` is `flower` (dahlia, sunflower,
  tulip) that has been ready for at least 4 ticks (`spoil` meter +25 per tick, needs 100). Without such flowers they idle.
* Each return trip adds `honey_per_bee` (1.5) percent to the honey bar; at 100 a box of 4 honey can be collected and the bar resets.

## Workers (`CWorker::sub_4256C0`, `CHarvestAI`, `CHelperAI`)
* Work counter starts at `work_time`, decremented once per second; at 0 the worker waits for payment (coin).
  A question mark means no target/path was found.
* `CHelperAI` (`sub_405110`): the helper carries a **weak fertilizer**. Target: plants that are not already being fertilised
  and have `health <= 60`, scored by `(health + 40) / 100 * distance`. It does **not** water.
* `CHarvestAI` (`sub_404960`, `sub_4052B0`, `sub_415100`): the harvester carries a box. With an empty box it picks the fruit
  type that is ripe in the largest quantity (among the types the level allows) and goes to the nearest ripe plant/tree of that
  type; with a partial box only that same type. Only a **full** box is delivered, to the nearest hangar that accepts the box's
  goods type. A half-filled box is dropped if nothing of its type exists any more.

## Still open
Hero animation timings (beyond the duration table in "Hero action durations"), which crops a level allows the
harvester to take (`level+9992`), exact bee wing/flight visuals. Prices, level time limits and the heroine's
speed are script data (object/level scripts; see `docs/levels.md`).

## Level completion, records and trophies (`sub_42F2B0`, map screen handler for "level finished")
* The finished level is marked completed. If the level took no longer than its `level_time` (seconds, the bar on the HUD)
  it is **gold**: the level's trophy `#(level-1)` is granted (`trophy_hint0..11`).
* When all 12 level trophies are owned, trophy `#12` (the cup) is granted as well.
* Records per level: best time = minimum (`sub_40D160`), best money = maximum (`sub_40D1B0`); both are shown in the
  map's info window (`--:--:--` / `---` until the level is finished).
* After the level: new trophy -> trophy room with an announcement; otherwise map with the next level selected;
  after level 12 the final comics (`comics12_pack`).
* Plot flags (`CGardenPlot`): +8988 completed, +8989 gold, +8990 comics_ready, +8991 comics seen. Progress is stored
  in `<profile>.sav` / `<profile>.tro`.
* Not verified: strict level unlocking (the port opens level n after level n-1 is finished); the "Load saved game?"
  question after Start.

## Textures
The `.jpg` files carry their alpha channel after the JPEG data (`NSOGLRender.dll` `sub_10002190`):
`[jpeg][w*h alpha bytes][u32 count][0x6666]`. `tools/extract_jpg_alpha.py` restores it.

## Comics (`interfaces/comics.txt`, `sub_42DAD0`, `sub_43CC10`, `sub_40F910`)
* 13 pages: page n belongs to level n, page 13 is the finale. The page texture's alpha shapes the frames (circles).
* First "Start" of a level whose comics was not seen: comics page n first (flag +8991 "seen"), then the level
  (`index | 0x80` = "start the level afterwards"). The camera button on the map replays the page of the selected level.
* Frame: flies from `start_point` (top-left) to `end_point` with `start_angle`, `start_size`, `start_alpha`.
  A frame's first balloon shows when it lands, every click shows the next one (one at a time), then the next frame.
* Balloon `pos` is the arrow tip; the 276 px box is 13 px away from it (`lu/ru/ld/rd` = where the arrow is).
  Text is white with a dark outline on a white box. Skip button -> everything shown, then the "continue" arrow.
* After level 12 with no new trophy the finale comics (page 13) is shown.
* Boot: loader screen (`loadscreen` + `loadbar`), then the Nevosoft splash (fade 0.8 s, hold 3 s).

## Что перенесено / что нет (порт)

(Обновлено после восьмого пакета задач, 2026-11-11; сверка покрытия скриптов уровней — 2026-11-14. Подробности и умолчания — в `docs/open-questions.md`.)

### Игровая логика
- Перенесено: меню, карта, комиксы, прогресс/рекорды/трофеи, профили игроков, настройки, сохранение посреди уровня (включая ульи/пчёл), все 12 уровней, грядки/растения/животные/работники/пчёлы, магазин/постройка/продажа, вёрстка окон по интерфейсным скриптам.
- Часть 2 (задача 4, 2026-11-14): события-группы с типизированными условиями, расстановка поля (`add to field`/`add bed`), `allow action` и прополка, инструменты bulldozer/constructor/destructor, генераторы/рубильники/маркеры, боксы fivebox/multibox, дома/ангары по спискам объектов части 2 и апгрейды — см. раздел «Часть 2: инфраструктура симуляции» ниже.
- Перенесено (пакет 4): счётчики `worker_coin`/`worker_question` (задача 21), поля `none W H` и дробные позиции разбрызгателя (задача 22), клик по грядке/растению под ногами героини (задача 27).
- Проверено (2026-11-14, сверка `assets/scripts/level*.txt` с `src/sim.js`): все 16 типов действий, встречающихся в скриптах уровней, обработаны в `runAction` (`src/sim.js:322`) — `add to shop` (357), `show message` (174), `add to field` (127), `set task`/`add task` (90+90), `enable condition`/`disable condition` (79+75), `add money` (31), `add field` (25), `victory` (15), `delete shop` (14), `defeat` (12), `add particles` (6), `set money` (4), `show help` (1), `add notify` (1); все счётчики условий скриптов (`sow_*`, `sell_*`, `place_*`, `dead_plant_*`, `maxhealth_plant_*`, `fruits_ready`, `goods_ready`, `house_fed`, `sick/thirsty_plants`, `worker_coin`/`worker_question` и т.д.) вычисляются в `counter()` (`src/sim.js:266`). Пробелов в игровой логике нет: остаются только звуки `go`/`maxplayers` (см. «Звук»).
- Сверено с дизассемблером (2026-11-14, см. «Scenario counters»): семантика счётчиков условий. Кумулятивные (`thirsty_plants` — пересечение 66 вверх; `fruits_ready` — созревание плода растения, деревья не считаются; `goods_ready` — цикл производства дома; `house_fed` — кормление; `plants_watered`, `fields_dug`, `sow_/sell_/place_`), живые пары inc/dec (`sick_plants`, `maxhealth_<id>`), one-shot (`worker_coin`, `worker_question`), `dead_*` — смерть или уничтожение деструктором (`0x41A170`); `buy_` в оригинале никогда не инкрементируется. Диспетчер действий `sub_40FAA0` знает 17 типов; в шипованных скриптах не встречаются: `any_condition` (OR-режим условий действия, порт не поддерживает — допустимо) и `add shop notify N` (`sub_40FAA0`, ветка `wcsstr`: N парсится из хвоста строки типа, показывает уведомление над N-м предметом меню `gameplay.shop_form.shop_menu`; `notify_holder` получает позицию предмета +25 по y и текст из `data`).
- Не проверено по оригиналу (безопасные умолчания): поведение клика по самой героине, зона разбрызгателя при дробной позиции.

### Звук
- Перенесено: все 67 звуков манифеста там, где они задействованы; музыка экранов (в exe захардкожена так же); клики по животным/улью (`name_sfx`, `bees_sfx`), посев (`sow`), удобрение (`fert_spreader`), продажа (`profit`), покупка/размещение (`pay_shop`, `house_place`, `tree_place`, `put_*`, `take_*` — пакет 4, задача 23).
- Закрыто: озвучка комиксов в этой версии оригинала не звучит (файлов нет, задача 25); `bee_wait` в оригинале отсутствует, `check_audio` больше не считает это ошибкой (задача 24); паки по экранам не различаются (задача 26).
- Перенесено: фон уровня по `level_env` (`updateAmbient` в `src/sim.js`, оригинал `sub_415420`): трава — `birds1..4` каждые 6–12 с, болото — `swamp1`, пустыня — `desert1` каждые 20–25 с, первый звук через ~1 с.
- Перенесено по дизассемблеру (2026-11-11, см. «Hero action sounds»): `watercan` (полив героиней), `waterpump` (заправка лейки у насоса), `transporter` (кран), `add_trophy` (конец уровня с новым трофеем; без трофея — `next_level`).
- Не перенесено: `go` (виртуальный метод базового интерфейса `sub_408940`, повод не найден), `maxplayers` (есть только в списке `@sample`, кодом не запрашивается).

### Локализация
- Перенесено: 12 языковых паков, переключение языка в настройках, запасные русские тексты для отсутствующих ключей rus,
  цепочка запасных языков в `t()` (задача 39): выбранный язык → `eng` → `rus` → переданный `fallback` → сырой ключ.
  Пак `eng`/`rus` подгружается лениво только когда нужен (при языке rus/eng лишних запросов нет), смена языка сбрасывает кэш;
  пустые значения в цепочке пропускаются. Проверка: `tools/test_texts_fallback.mjs`, аудит `tools/check_i18n.mjs` помечает
  недостающие в паке ключи как «покрыто цепочкой».
- Не перенесено (и не нужно): ключи, отсутствующие во всех паках, — показываются запасным текстом или сырым ключом
  (`l66_*` уровня 0, имена объектов, text_key-пустышки скриптов; перечень — `docs/open-questions.md`).

### Графика
- Перенесено: все текстуры манифеста, извлечённая альфа 29 jpg (комиксы, декор, кромки грядок, обзорные) и ещё 30 jpg
  (задача 31: грядки `beds_dry/wet`, 24 тайла полей, HUD-панели `upbar`/`downbar`, кнопки магазина `item_shop_menu`/`shop_item`),
  GUI-окна (3×3-slice), частицы, анимации растений/героини/работников, зона разбрызгателя, бейджи лейки/пакета/ящика.
- Не перенесено: маска `mask_upbar` — портом не используется, извлечение не требуется
  (отчёт — `docs/jpg-alpha-report.md`).

## Shop tabs (`menuhost_scripts.txt` shop_form, `sub_4178C0`, `sub_417580`)
* `shop_form`/`shop_menu` is a horizontal `simple_popup` with a static `item_list` of six `tab_button`s:
  `inventory_form`, `buildings_form`, `seeds_form`, `sprouts_form` ("Plants"), `trees_form`, `workers_form`.
  No code in the exe hides a tab: all six are always shown.
* Each category has its own popup form (`<cat>_form`/`<cat>_menu`, 800x64, items `speed_button`); only `inventory_form`
  is alive at start, the others are shown when their tab is selected.
* `add to shop` (`sub_4178C0`) puts the item into the menu named after its `type_goods`, sets its price text and
  `<name>_shop_hint`; when `dword_483FD0+9972 > 1` it also shows `notify_add_shop_<name>` above the tab bar.
  `delete shop` (`sub_417580`) removes the item (and its hint) from that menu.

## Bottom panel layout (`menuhost_scripts.txt`, `CPopupMenu` `sub_4391A0`/`sub_439500`/`sub_439100`, `CTextElement` `sub_4331E0`)
Coordinates of forms/children: origin = centre of the parent, y up (verified: upmenu_form pos y=268, timebar (-167, 9)).
Verified on a screenshot of the original (2x scale, English tabs): every number below agrees to within 1 px.
* **Panel**: `popup_window` 800x64 at y=-268 (centre y=568); its `center` bitmap is 800x78 with texcoord (0, 0.39)-(1, 1)
  of `downbar` (rows 50..127) and is centred, so the lowest 7 rows fall off the screen: the visible panel is
  y = 529..600 (71 px), the gold line lies at texture row 56.
* **Items** (`inventory_menu` and the other five): `CPopupMenu` 800x100 at (0, -3) -> centre y=571; `speed_button` 58x58,
  margin 0, centred in a row (`x0 = (m+w0)/2 - total/2`), so the boxes occupy y = 542..600 (flush with the screen edge)
  and a row of 10 starts at x=110. The item `image` fills the whole button (58x58, texture scaled), `price` text is
  17 px below the centre (y = 588). More than 13 items overflow: items whose centre is past the right edge get
  disabled (`sub_439100`: `enabled = popupRight > item.x`).
* **Which item goes to which tab**: by `type_goods` = the menu name (`seeds`, `sprouts`, `buildings`, `trees`, `workers`,
  `inventory`); `plants` (placed plants) and `personal` (hero, waterboy) have no menu and are not sold. Button picture =
  plain `<item name>.tga` (`sub_439500`), never the environment variant (`grass_house_chicken` is the big sprite).
* **Tabs** (`shop_form`/`shop_menu`): popup 800x32 at y=-220 (centre y=520, so tabs span y = 504..536), `margin 32`.
  `tab_button` is a `checkbox` of height 32 whose width = **text width** (`CTextElement autosize true`:
  parent width = sum of glyph advances * font_size, `sub_429FA0`); `caption` is `font_size 12` at 4 px below the centre.
  Glyph advance table: `fonts/<font>.dat` = u16 texW, u16 texH, u16 cell, u16 0, then 65536 {u16 adv, u16 code};
  `table[code] = adv * 2 / (texW / cell)`; font per language: chn/jap/kor have their own, the rest use `uni`
  (`config_scripts.txt`). Example (English): SUPPLIES 73, BUILDINGS 87, SEEDS 49, PLANTS 61, TREES 48, WORKERS 79 px.
* The tab bitmaps: centre piece stretched over the body width, 16 px caps *outside* the body (`pos -16`), so tabs of
  stride `w + 32` touch each other. Unchecked 32 high; checked 64 high, shifted 13 px down (y = 501..565): it is 3 px taller
  than the others at the top and its lower half blends into the panel. Click area stays the 32 px checkbox.
* The row is laid out as the popup code says: total = sum(w) + 5*32, the first body starts at `-total/2 + margin/2`
  from the centre. All six tabs fit for all 12 languages; a tab that did not fit would be disabled.
* Port: `src/fontmetrics.js` (`layoutPopup`, `textWidth`), `buildTabs` in `src/ui.js`, `tools/test_popup.mjs`.
  Our caption uses a web font, so it is stretched horizontally (`scaleX`) to the width the bitmap font would have.
  There are no tool slots (the spade and the held item are visible on the hero).

## Plant animation (`sub_41F2A0` plant update, `CAnimationEl` `sub_432210`/`sub_432B50`, `CSpriteElement` `sub_4329E0`)
* Stage (`+9576`) only moves one step up per game tick: 0->1 growth>10, 1->2 growth>90, 2->3 fruit progress>50,
  3->4 ready. Every step sends `plant_growth<N>`; a harvest with `complete_harvest` resets the stage to 0 else to 3.
* Animation request `plant_idle<stage>` is sent on every update. `CSpriteElement::setAnimation` (`sub_4329E0`)
  ignores a request while the current animation is still playing, so `plant_growth<N>` plays once and then
  `plant_idle<N>` restarts itself every time it ends (= a loop with its own clock per plant).
* `CAnimationEl`: frame time = 1000/`frame_per_second` ms; at the last frame it stays "finished" (no loop of its own;
  property `random` would replay it every 8 s).
* **Sheet geometry**: a frame is exactly as large as the sprite element (`size`, e.g. pumpkin 62x49), columns =
  `floor(texW / frameW)`, and the texture rectangle of frame i is `x = col*fw + 1 .. (col+1)*fw`,
  `y = row*fh + 1 .. (row+1)*fh` (1 px inset left/top). Sheets are 1024 wide (16 columns of 62 px for the pumpkin).

## Particles (`particle_scripts.txt`, spawn `sub_409B00`, update `CParticle` `sub_408DE0`)
* Spawn: `sub_409B00(x, y, count, template, owner)`; every value is `base + random(-scatter, scatter)`.
  Position = (x, y) + a point at radius `pos_scatter` in a random direction; direction random when `start_dir` is
  absent, speed = `start_speed` + scatter; size/size_speed/angle/angle_speed likewise; colour channels = `color` +
  `color_scatter` clamped to 0..255; colour speeds = `color_speed` + `color_speed_scatter` (r, g, b, a).
  `texture_num` is a cell of the 8x8 particle sheet (`texture_num % 8`, `/ 8`); `blending` = additive.
* Update (times in ms, y up): `pos += vel*dt; vel += gravity*dt; size += size_speed*dt` (dies at 0),
  `angle += angle_speed*dt`; r/g/b move by their speed and **bounce** at 0/255; alpha dies at 0.
* A ripe plant (`sub_41F2A0`) plays `ready_plant.ogg` and spawns `fruit_ready` x50 at (x, y + 32): white/yellow
  twinkling stars (cell 33), size 32 shrinking by 0.07/ms, gravity 0.0005/ms^2.

## Beds (`CSquare`, vtable 0x463754, draw `sub_420E40`, init `sub_4213F0`)
* Every dug cell is a `CSquare`; it is drawn **72x72** (the 64 px cell x 1.125, so neighbours overlap by 4 px) with a
  random variant 0..3 chosen once: frame `variant` of `beds_dry` / `beds_wet` (256x64 = four 64 px frames).
* Draw order: top / left / right grass strips, dry bed, wet bed, fertilizer overlay, bottom grass strip.
  Strips exist on the sides without a dug neighbour (flags `+9564` top, `+9565` left, `+9566` right, `+9567` bottom).
  `<env>_bed_ud` (128x256, rows of 32): top uses row `variant`, bottom row `variant+4`, 96x32 centred on x, centres at
  top-12 (above) / bottom+0; `<env>_bed_lr` (256x128, columns of 32): left uses column `variant`, right `variant+4`, 32x96,
  centred at left-10 / right+10; UVs are inset by 0.0039 (1 px).
* Wet overlay alpha = `(100 - plant.dry) * 2.55`; a bed **without a plant is fully wet** (brown), the dry (yellow)
  texture only shows under a thirsty plant.
* Fertilizer overlay `fertilizer_on_bad1|2` (random 1..2) over the whole square, alpha = ticks left / total ticks.

## Field border (`CGameField`, vtable 0x46153c, draw `sub_412220`, init `sub_412FD0`)
* The field is `gridW*64 x gridH*64`; the outer **128 px (2 cells)** are a decorative border, level content starts at
  cell 2 (level scripts use coords >= 2). Inner rect = `(W-256) x (H-256)`.
* Draw order: centre tile (512 px, repeated, scaled by `(H+128)/H` vertically, starting 64 px above the field);
  `down_center`, `up_center` (128 px high, u = 0..W/512 across the inner width), `left_center`, `right_center`
  (128 px wide, v = 0..H/512 across the inner height); corners `left_up`, `right_up`, `left_down`, `right_down`
  (128x128) in the corners; finally the decor layer (`decor`).
* Decor (`sub_411E60` count, `sub_412BE0` filling): `int(gridW*gridH/33)` quads of 64x64, each centred at a
  uniformly random point of the whole field (the border included), sprite = cell of the 8x8 `decor` sheet:
  grass `rand(18)` (0..17), desert `24 + rand(13)`, swamp `40 + rand(10)`; drawn as part of the field, i.e. under beds,
  plants and objects, with no check against objects or the hero.
* Textures are `<env>_*` jpgs with embedded alpha (see Textures); the border shows a wooden fence (grass) /
  bone-like fence (swamp).

## Sprinkler zone (`CWaterSprinkler` `sub_4239C0`, update `sub_423D00`)
* `sprinkle_radius` (cells, e.g. 4.5, 2.5) is an ellipse: every 64 px cell with `(dx/rx)^2 + (dy/ry)^2 <= 1` is watered
  (strength per `sprinkle_frequency` ms). The zone is drawn as one `wcircle` tile (64x64, blue, translucent) per such cell.
* It is drawn while the sprinkler has no parent (it is being carried after the purchase: centred on the cell under the
  cursor) or while its hover flag (+8729) is set (mouse over a placed one). Port: `drawSprinklerZone` in `src/render.js`.
* A placed sprinkler **spins all the time**: `sub_423D00` requests `water_sprinkler_work` (32 frames, 24 fps) on every update and
  `CSpriteElement::setAnimation` lets a running animation finish, so it restarts by itself; `water_sprinkler_stop` is only the
  initial animation. The carried one is drawn the same way on the cell under the cursor (`drawSprinklerGhost`).

## Buying, placing and selling sounds (`sub_416670` placement click, `sub_41AC00` sale)
* **Every purchase except a patent** (items, buildings, trees, sprinklers, workers) is attached to the cursor; the player
  picks a cell and clicks - the hero does not walk there. Only then the price is taken, `pay_shop.ogg` plays, then the sound of
  the type (`house_place` houses/hangars, `tree_place`, `put_sprinkler`, `put_box`, `put_bag` seeds/fertilizer, `put_watercan`)
  and 50 `object_bought` particles appear on the object. Seeds, cans, boxes and fertilizer lie on the ground afterwards and the
  hero picks them up by a click. A second click on the same shop button (or the right mouse button) cancels the selection at no
  cost; a patent is an order paid at the click. Port: `pending`, `placePending` in `src/sim.js`, ghost in `src/render.js`.
* Selling goods in a hangar plays `profit.ogg`; `pay.ogg` is only for paying a worker.

## Movement of the hero and the workers (`CMover` `sub_403C00`, `sub_402A40`, `sub_401A30`, `sub_401D00`)
* **No grid path-finding.** A click adds a waypoint (`sub_402A40`, queue of up to 256, 20 bytes each) at the target point itself
  (for an object: its dock/target point); it must lie inside the field rectangle, otherwise `notify_you_cant_gowhere`.
* Speed: script `speed` (300) * 0.00105 = 0.315 px/ms = 315 px/s **horizontally and half of it vertically**: the heading is the
  normalised vector to the target, the step is `(nx * S, ny * S / 2) * dt`. When `|step| >= distance` the actor snaps to the
  waypoint and the next one starts. Workers use the very same code (the vtable slots are shared).
* **Obstacles**: the actor is an ellipse (`base_radius` 2x2); a step is blocked when it overlaps the base ellipse
  (`base_center`/`base_radius`) of a solid object, test `((dx)/(r1x+r2x))^2 + ((dy)/(r1y+r2y))^2 <= 1` (`sub_4014F0`). Then the heading is
  rotated in 5 degree steps to one side (side chosen at the first contact, kept for 2 frames after) until it is free, so the actor
  slides round the object; inside the dock zone of the object it walks to, the base ellipse does not block.
* **Facing for animations**: every 100 ms `index = floor(angle / 45 + 0.5) % 8` of the heading with y UP: 0 right, 1 up-right,
  2 up (back view), 3 up-left, 4 left, 5 down-left, 6 down (front view), 7 down-right; `hero_walk<i>`, `hero_carry_*<i>`, `<worker>_walk<i>`.
  (Our earlier mapping was rotated by a quarter turn.)
* Idle animations: `hero_idle1` with a 1/10 chance of `hero_idle2`; holding a can/seed/box uses `hero_idle_<item>`.
* Port: `moveActor`, `solidObstacles`, `walkToPoint`, `dirIndex` in `src/sim.js`; A* (`findPath`) and the per-frame `unstickHero` are gone.
  Workers read `def.props.speed` from the object script; the heroine's speed is hardcoded 300 (= `hero.txt` `#float speed 300`).

## Queue of targets and the yellow check marks (`CMover`, draw `sub_41C5E0`, textures `flag.tga` / `flag1.tga`)
* Every click that gives the hero or a worker a target adds an entry to the actor's queue (up to 256, 20 bytes each: x, y, flag).
  The marker of every entry is drawn as a 64x64 sprite at its point: `flag.tga` (the yellow check) for a plain click: the hero just walks there (and for an action on an
  object: box, tree, hangar), `flag1.tga` (a ring) for a double click on bare ground: the hero walks there and digs it (user-described original behaviour). Several entries on one object are
  several checks, one on top of the other. The entry is removed when the actor reaches/finishes it.
* What the hero does with an entry is decided when it is executed, not when it is clicked: box -> tree -> hangar can be clicked in a row
  (the tree is accepted while the box is not yet in hand), the checks stay on all three until each step is done.
* Port: `click()` / `nextQueued()` / `queueMarks()` in `src/sim.js`, `drawQueueMarks` in `src/render.js`, `tools/test_queue.mjs`.
  Port additions (not in the original as far as known): a click on the hero herself, WASD or `rightClick()` clear the queue; a
  double click replaces a just-queued single click at the same spot; repeated checks on one target are drawn shifted by 12 px.

## Ripening indicators of trees and buildings, pause menu (`sub_4222F0`, `sub_422180`, `sub_41CFA0`, `sub_418FF0`, `sub_405C50`)
* `sub_405C50(x, y, w, h, cell, n, cols, gap, filled, total, grow)` draws `n` icons (icons.tga cell, >= 256: icons_ex.tga) in rows of `cols`
  with `gap`, centred on the object position + (x, y) (y up), the first `floor(filled / total * n)` bright, the rest dim; `grow` enlarges them.
* **Tree** (`CTree`): crown fruit sprites `<name_fruit>_<a|b|c>_<i>` (one per `@fruit` child): nothing below 33 % of the ripening meter,
  `a` from 33, `b` from 65, `c` at 100 (ripe). Indicator: with the mouse over an unripe tree a row of 5 fruit icons (32 px, cell `ready_icon_num`,
  gap 0, at `ready_bar_pos`, default (0, 64)) fills with the progress; a ripe tree always shows ONE 64 px icon of that fruit at `ready_notify_pos`
  (= `ready_bar_pos` by default) - the apple above the apple tree.
* **Animal house** (`CHouse`, always visible): right cluster = product icon (`ready_icon_num`: 20 egg, 21 milk, 22 wool, 23 pork; 48 px at (48, 64))
  under 5 pips (cell 29, 8 px, gap 4, at `ready_bar_pos`) filled by the production progress; left cluster = feed icon (cell 25, 48 px at (-48, 64),
  pulses `2 * sin` over 1 s while the food is under 20 %) under 5 pips at `feed_bar_pos` filled `ceil(food / 20)`. Production at 100 adds a 64 px bubble
  with the big product (icons_ex cell `ready_icon_num + 332`: egg tray, milk can, wool, pig). Mouse over the house: the feed icon shows what the animal eats
  (half-size icons: pig 1 + 14, sheep 2 + 3, cow 2 + 3, chicken 4).
* **Beehive** (`CBeehive`, always visible): row of 5 honey icons (cell 24, 32 px at (0, 80)) filled by the honey bar; when it is full it blinks
  (visible in the second half of every second).
* **Pause menu** (`main_menu_form`, 220x200): restart, exitgame (Quit), options, continue - four items. The texts `question_saveandexit_game`
  ("Save this game before you quit?"), `question_exit_game`, `question_end_game`, `question_replay_game` exist; the exact branches of Quit are not recovered.
* Port: `drawTreeFruit`, `drawHouseStatus`, `drawIconRow` in `src/render.js`; `renderIngame`, `confirm3` in `src/menu.js`.

## Hero action sounds (`sub_4031F0`, hero state switch; `sub_416670`, `sub_42F2B0`)
* The hero's state machine plays the sound when the state starts: take (2: `take_box`/`take_watercan`/`take_bag` by item type),
  put (3/4: `put_box`/`put_watercan`/`put_bag`), 5 `dig`, 6 `sow`, 7 `watercan.ogg`, 8 harvest (`harvest_plant/tree/beehive`,
  animal by house type), 10 `fertilizer` (helper) / `fert_spreader`, 11 `waterpump.ogg`, 12/13 `put_box`, 14 feed_<animal>,
  15 `killplant`, 17 `pay`. States 7 and 11 are inferred as «water a plant» and «fill the can at the pump» (the only two water
  states; no direct caller found). `watering_sfx` is NOT a hero sound: it is the sprinkler's `name_sfx`.
* The crane (`sub_416670`, two branches: pick up / pay for the move) plays `transporter.ogg`; the destructor plays `killplant.ogg`.
* Level end (`sub_42F2B0`): a new trophy -> `add_trophy.ogg` and the trophy room; otherwise `next_level.ogg` (map or finale comics).
* `go.ogg`: only in the base interface virtual method `sub_408940` (stores a target interface name and dispatches message 4/10);
  trigger not identified. `maxplayers.ogg` is listed in `@sample` but never requested by code.

## Sound packs (`soundhost_scripts.txt`, `sub_408C50`) and level ambient (`sub_415420`, задача 26)
* Each interface script (`loader/intro/menu/gamemap/gameplay/comics/credits/trophyroom.txt`) declares
  `#string sound_pack "…"`. The parser (`sub_408C50`, a property vtable slot) stores the string in a script
  object field (+4376); **no read of that field exists in the exe** (no `[reg+1118h]` anywhere) — the sound
  pack name is parsed and effectively ignored.
* `soundhost_scripts.txt` defines a single pack `@main_pack`: `@music` and `@url` are empty, `@sample`
  holds every effect (including `birds1..4.ogg`, `swamp1.ogg`, `desert1.ogg`), `@stream` holds the six
  music files (`music_menu/comics/map/trophy/mix/credits.ogg`). So the per-screen pack names
  (menu_pack, gamemap_pack, …) do not exist and the sound content does not differ between screens.
* Per-screen music is **hardcoded** in the exe screen handlers: menu → `music_menu.ogg` (`sub_43ED40`),
  map → `music_map.ogg` (`sub_43C550`), gameplay → `music_mix.ogg` (`sub_43D020`), comics →
  `music_comics.ogg` (`sub_43C2C0`), credits → `music_credits.ogg` (`sub_43C45F`), trophy room →
  `music_trophy.ogg` (`sub_440510`). Loader/intro have no music. This is what the port already does.
* **Level ambient** (`sub_415420`, gameplay host update; the check runs once per accumulated second):
  by the level's `level_env` (`this+9798`):
  * `grass`: every 6–12 s (`flt_483FD8 = -(6000*rand + 6000)` ms) plays `birds<rand()%4 + 1>.ogg`
    (birds1..4, random pick), volume 1.0, no loop;
  * `swamp`: every 20–25 s (`-(5000*rand + 20000)`) plays `swamp1.ogg`;
  * `desert`: every 20–25 s plays `desert1.ogg`.
  Playback `sub_429240` is the BASS channel call (volume 1.0, pan 0, 44100). The first sound plays ~1 s
  after the level starts. Not tied to `sound_pack` in any way. Port: `updateAmbient` in `src/sim.js` (timer is not saved; `tools/test_sim_rules.mjs`).

## Hero animations that depend on the can (`sub_41C140`, `sub_41BF80`)
* Small orange can (`watercan`): `hero_take_watercan2`, `hero_put_watercan2`, `hero_water2`, `hero_idle_watercan`, `hero_carry_watercan<i>`.
  Big blue can (`big_watercan`): `hero_take_watercan1`, `hero_put_watercan1`, `hero_water1`, `hero_idle_big_watercan`,
  `hero_carry_big_watercan<i>`. Using one set for both made the can change colour while it was taken/put.
* **Water in the can / seeds in a packet** (`CWatercan` `sub_423280`, packet `sub_420870`): while the object's highlight flag
  (+8729) is set - the hero sets it every frame for the item he carries, the mouse sets it for a lying one - it draws a
  32x32 icon at (-16, +48) from its position and the text ` x<count>` (white, size 12) at (+16, +48). The can uses the
  blue drop (icons.tga cell 27), a packet its `seed_icon_num`. A carried item sits 100 px above the hero's feet.
  Port: `drawCountBadge`, `drawObjectBadge` in `src/render.js`. `sub_405C50(x, y, w, h, cell, n, cols, gap, filled, total)` draws `n` icons
  in rows of `cols`, centred on (x, y) from the object's position (y up); the first `filled/total*n` are normal, the rest are
  tinted 0xA0808080. So the can/packet badge is the icon centred at (-16, +48) and the text centred at (+16, +48).
* **Fruit box** (`CBox` `sub_419B20`, hero `sub_41B470`): highlighted (carried, or under the mouse) it draws 4 icons of its fruit
  (32 px, row centred at +48, `count` bright, rest dim); carried: 100 px above the feet. Besides that the contents are a pile
  of fruit: frame `PILE_BASE[iconNum % 25] + (count == 4 ? 8 : 0) + slot` (cells < 256 of icons.tga, >= 256 of icons_ex.tga), on
  the hero at the offset `PILE_OFF[slot]` from his feet, slot = `(14 - dir) % 8` while walking and 0 standing; on a box lying on
  the ground slot 2 at (+2, +14). Port: `drawFruitRow`, `drawPile`, `drawBoxContents`.
## Hero action durations (`sub_4031F0`, hero state switch, field +0x3938 in ms)
take/put 500, **dig 1500**, sow 1000, watercan 1000, harvest 1000, fertilizer 1000, pump/fill 1000, put box into the hangar 1500
(otherwise 500). The port used shorter times before (dig 0.9 s); now it follows the table. Walking speed is unchanged:
`speed` 300 * 0.00105 px/ms (`sub_401D00`) = 315 px/s horizontally, half of it vertically; the unit of `flt_482CB0` (dt) is not
confirmed independently (it is written outside any xref), so the walking speed remains the one derived from the code.

## Plant indicators (`sub_41F100`)
Under the mouse: two rows of five 16 px icons (`sub_405C50`) above the plant: hearts (icons.tga cell 26, at +56) lit by `health` (0..100)
and drops (cell 27, at +40) lit by `100 - dry`. Always: one big 32 px heart at (-16, +20) when `health <= 19` and one big drop at (+16, +20)
when `dry >= 66`. Port: `Renderer.drawPlantMeters`.

## Game map (`interfaces/gamemap.txt`, `sub_42EBF0` update, `sub_42E400` draw)
* `level_bar.tga` (1024x128, 12 blue cells) is stretched to the 800 px window: cells of 66.7 px, one level coin per cell (inside y 59..121).
* The traveller `star.tga` (64x128: the heroine on a pedestal) is drawn 32x64 centred 32 px above the point of the road (`+0, +32`, y up) and
  walks along the splines from the previous level to the chosen one (20 nodes per segment, plot by plot); the map camera follows it.
  Port: `.map_marker`, `travel()` in `Menu.renderMap` (speed 32 ms per node is a guess).
* Hint (`level_info`, window 200x110): name (font 14) at y 0, result line at 20, own time at 40, "best_time" header at 60, "<player> <time>" at 76.
* Back / Start: the caption is centred on the visible oval of the button texture (back: x 19..109 of 128; start: x 91..256 of 256).

## Comics balloons (`sub_4335A0`) and playback
* The box centre is half its size + **24 px** away from the arrow tip (our code used 13, which let the arrow cover the first letters of the
  text, e.g. "Теперь" on the page of level 2). The arrow image sits on the tip.
* The comics plays on its own in the original; the port now advances by a timer (`700 + 40 ms` per character, at least 1.5 s; a frame with no
  balloons waits 0.5 s) and a click / Space still shows the next step at once. The timing is a guess (`time_show 500` of the page is not used).

## Часть 2: инфраструктура симуляции (задача 4, `src/sim.js` + `src/sim_infra.js`)

Перенос поведения по скриптам объектов/уровней части 2 (`assets/scripts/objects`, `level1..24*.txt`).
Дизассемблер `Game.dll` части 2 не разбирали (IDA-скрипты есть только у части 1); всё, что не видно
из скриптов, помечено как умолчание и продублировано в `docs/open-questions.md`.

### События (`@event`) и условия (`@condition`)
- Сценарий уровня — это `@event`-группы: действия события выполняются, когда истинны **все** его
  условия; событие без условий — сразу (`default placement` из `_entry` выполняется первым, потому что
  события entry вставляются в начало сценария — `src/data.js loadLevel`).
- Событие после выполнения помечается флагом (`firedEvents`, условие `enabled by event`; `disabled by
  event` — «событие ещё не выполнено»), события выполняются один раз. `@pattern` — шаблон события,
  в рантайме создаётся действием `add event from pattern` (перезапускаемые цепочки: L3 охрана, L15
  дождь, L19 время суток); в сейве восстанавливаются списком `dynamicEvents`.
- Условие события: `#string type` + `#string data`-порог. `enabled/disabled by event` — флаги событий;
  `end dialogue X` — флаг диалога (наполняет задача 6, порт по умолчанию — «ложь», диалоги не показаны);
  `@condition` без `type` (level11) — выполнены все события из `data` через запятую. Остальные типы —
  сравнение счётчика: имя = тип условия с подчёркиваниями вместо пробелов
  (`sell plant_tomato` → `sell_plant_tomato`, `upgraded house_sheep 1` → `upgraded_house_sheep_1`),
  порог — из `data` (`>=4`, `<100`, `=0`; пустой порог — «хотя бы раз»).
- Псевдонимы счётчиков: `dig_bed` = `fields_dug` (копание героиней; расстановка скрипта не считается),
  `game_time`/`time` = секунды уровня, `switches_on` = включённые рубильники, `all_switches_on` = 1,
  когда включены все. `@action` с `#float delay` — отложенные действия, delay в **миллисекундах**
  (в части 1 порт считал секунды — значения там были 1..5, разница не была видна).

### Расстановка поля (`add to field`, `add bed`)
- `add to field` (часть 2): data = `"obj x y [arg]"`, координаты — клетки поля (дробные), пиксели =
  `coord*64 + 32` (как в части 1). Четвёртый аргумент: `no_fruits` — дерево-декор (не зреет); число —
  начальный апгрейд дома/фабрики (0 = требует ремонта, см. «Дома»); строка — тэг экземпляра персонажа
  (`guard … oleg`); `near_hero` — предмет у героини. Заборы и декор ставятся и за пределами поля.
- `add bed`: data = `"x y w h [plant]"` — готовые грядки (CSquare, wet = 1), опционально с растением
  (plant_bur/plant_nettle — сорняки). Скриптовая расстановка не увеличивает `dugCount`/`dig_bed`.

### Действия героини и `allow action`
- Действия героини: `dig, plant (посев), weed (прополка), harvest, water, fertilize, sell, switch, fix`.
  Начальное состояние — свойства уровня `#bool cant_*` (`cant_generator_fix` → `fix`), действие
  `allow action "имя 0|1"` меняет их по ходу уровня (уровень 1 открывает посев/прополку/сбор по мере
  обучения). Запрещённое действие: клик превращается в простой ход, продажа сообщает `notify_cant_sell`.
- Прополка: клик по растению с `#bool weed true` (plant_bur, plant_nettle) пустыми руками — анимация
  `hero_hands_up` (0.5 с, из animationhost), растение убирается, счётчики `kill_<имя>` (условия
  `kill plant_bur`) и `dead_<имя>`. Звук `killplant` (отдельного звука прополки в манифесте нет).

### Объекты части 2
- **decor_*/keyldo_*** (`@obstacle`): препятствия — блокируют клетки эллипсом `base_radius` (общий
  механизм solid). С `#bool destructable true` (bog, stones, brokentree…) убираются бульдозером;
  у остальных препятствий удаления нет.
- **fence_*** (`@fence`): некликабельный декор по периметру (solid false, base_radius 0), только отрисовка.
- **bulldozer / constructor / destructor** (инструменты, «услуга» за клик, героиня не ходит):
  bulldozer — сносит `@obstacle` с destructable (за `price`, звук `bulldozer`, счётчики
  `kill_<имя>`/`dead_<имя>`); destructor — уничтожает растения **и пустые грядки** (по подсказке
  магазина `destructor_shop_hint`, цена 5, звук `killplant`); constructor (@destructor с текстурой
  cultivator) — «заказ на вскапывание поля»: клик по свободной клетке мгновенно копает её за `price`
  (100), звук `dig`. На заблокированной клетке отказ.
- **generator / big_generator** (`@generator`): здание с `power_production`; действие
  `overload generator "<имя>"` делает его сломанным (`broken`), клик по сломанному чинит (действие
  `fix 1` разрешает, `#bool cant_generator_fix` запрещает), счётчик `fixed_generator`. Состояние
  `fixed` выставляет и действие `fix generator`. Какую роль играла выработка питания в геймплее —
  не восстановлено (open-questions).
- **megawaterpump** (`@waterpump`): большой насос — как водяная колонка (клик с лейкой наполняет её).
- **switch** (`@switch`): рубильник; клик при разрешённом действии `switch` включает его навсегда
  (текстура `texture_on`/`texture_off` — рисование в render.js, задача 6/7); счётчики `switches_on`,
  `all_switches_on`.
- **marker** (`@marker`): зона сценария; попадание героини в эллипс `base_radius` даёт счётчик
  `enter_marker` (один раз на маркер).
- **multibox / fivebox** (`@multibox`): боксы вместимости `boxcount` (7 и 5) вместо 4; флаг
  `#bool infinite` у multibox не расшифрован (open-questions). Сбор/продажа/кормление требуют
  полный бокс вместимости объекта (`boxCapacity`, `src/sim_infra.js`).
- **piece-предметы** (map_piece, mobilephone, mushroom, spare — `@piece`): подбираемые предметы;
  подбор даёт счётчик `take_<имя>` (условия `take map_piece`, `take mobilephone`, `take spare`…).
- **fake_fertilizer** (`@fertilizer`, `#bool fake true`, 12 зарядов): пока ведёт себя как обычное
  удобрение — «подделка» из сюжета уровня 22 не смоделирована (open-questions).
- **plant_bur / plant_nettle**: сорняки (`#bool weed true`, `cost_fruit 0`) — удаляются прополкой;
  растут/сохнут как обычные растения.
- **respawn** (`@obstacle`, decor): точка появления предметов действия `spawn object`; подбор
  предмета, созданного этим действием, даёт счётчик `take_from_respawn` (условие `take from respawn`).
- **Персонажи** guard/manager/looser/lightbug (`@worker`, `#int work_time -1`): спавнятся, стоят
  без дела, клики игнорируют (найм/ИИ — задача 5). Действие `kill all people` убирает
  guard/manager/looser (lightbug — не «человек»).

### Дома, ангары и апгрейды (изменения формата данных части 2)
- Ангар принимает не категории, а **объекты**: `@accept_goods_list` (`plant_tomato`, `tree_apple`,
  `house_pig`…). Дом кормится по `@accept_feed_list` (`plant_carrot`, `plant_corn`…). Часть 1
  (`#string accept_goods "vegetables …"`, `#string type_feed`) осталась запасным путём.
- Апгрейд дома/фабрики хранится на объекте (`o.upgrade`): 0 — не отремонтирован (не производит),
  1..3 — время цикла `time_complete_1|2|3` (в части 2 общего `time_complete` нет). Скриптовый
  аргумент 4-го поля `add to field` и действия `set upgrade "house_sheep 0 1"` / `upgrade house` /
  `upgrade factory "factory_sausage 2|-1"` меняют уровень и дают счётчик `upgraded_<имя>_<уровень>`
  (визуальные варианты спрайтов и эффекты фабрик — задача 5/7).
- Улей в части 2 — объект `house_beehive` (`@beehive`, раньше `beehive`): пчёлы, мёд и
  `ready_beehive` работают по типу `@beehive`, а не по имени.

### Счётчики сценариев, добавленные в порту
`kill_<имя>` (прополка, бульдозер), `dead_<имя>` (и прополка, и бульдозер), `take_<имя>` (подбор
предмета), `take_from_respawn`, `feed_<имя>` (кормление), `harvest_<имя объекта>` (сбор героиней и
работником; для деревьев — при сборе), `plants_fertilized` (удобрение, героиня и помощник),
`fruit_ready_<имя>` (созревание плода), `upgraded_<имя>_<уровень>`, `enter_marker`, `switches_on`,
`all_switches_on`, `fixed_generator`, `dig_bed` (= fields_dug), `game_time` (= time).

### Погода и время суток (минимум, отрисовка — задача 6/7)
- `start rain "heavyrain|monsoon_rain"` хранится в `world.rain`; `set sun "<уровень> <мс>"`,
  `start morning|day|evening|night|moon "<мс>"` — в `world.dayPhase`. Влажность/освещение/звуки
  дождя не смоделированы (см. open-questions).
- `water all` поливает все растения (без счётчика plants_watered — это сценарное действие).

### Не проверено по дизассемблеру (умолчания порта)
Пиксельный сдвиг `coord*64 + 32` для дробных координат; трактовка числа в `add to field` как
«целевой уровень» апгрейда; семантика `set plant health` (свойство + живые растения сразу); поведение
`infinite` у multibox; `house ready`; `visual effect`/`effect show`/`play loop music` (задача 6);
поведение сломанного генератора вне сценариев (нет модели «работы» питания). Полный список —
`docs/open-questions.md`, раздел «Часть 2, задача 4».


## Часть 2 (Farm Craft 2): Game.dll, восстановлено в IDA 9.5

Бинарь: `Game.dll` (x86, база 0x10000000; имена `sub_XXXXXXXX`). Рабочий приём: `strings_xrefs.py` по строке → `decompile.py` по функции;
vtable через `names.py`-подобный перебор имён `??_7C…AI@@6B@` (слот [1] — `update`). Координаты объектов в скриптах: мир = ((x − W/2)·64, (H/2 − y)·64).

### Охрана — `CGuardAI`, update `sub_10035D95`
* вектор «охранник → героиня» с **удвоенным dy**, длина d: `d < 90` — арест, `d < 450` — погоня (цель — позиция героини), иначе патруль;
* патруль: список путевых точек (по 8 байт), индекс по кругу; точка достигнута при расстоянии ≤ 32 px;
* арест: счётчик `arrested` (`sub_1002F139`), охранник замирает, анимация по направлению; повтор невозможен, пока `reset guards` не вернёт ИИ в покой;
* `add guard waypoint "x y [тэг]"` (`sub_1001B41C`): добавляет точку охранникам с тэгом (пустой тэг — всем); если маршрут пуст, точка = «дом»;
  `clear guard waypoints` — очистка и остановка; `reset guards` — возврат в «дом» и покой; `disable guards` — остановка, флаг +9925 (ИИ не работает).
  От ночи/света ИИ **не зависит** (свет выключают сценарием: `disable guards` / `kill all people`).
* `steal <имя>` — событие 1024 у **машины** (`truck`, `sub_10046948`): героиня сдала предмет/ящик (имя товара ящика — `+528`).

### Фабрики — `Factory`, update `sub_100331D4`
* поля скрипта: `max_resource` (+4156), `resource_time` (+4160), `profit` (+4072), `profit_source`, `indicator_icon_pos`, `enemy_factory`, `phase` (+6220, по умолчанию 3);
* три шкалы топлива по `@accept_feed_list`; доставка полного ящика (событие 4096, `sub_10033A59`): +100/max_resource (cap 100);
* `sub_10032E69(n)` — смена фазы 0..4 (вне диапазона игнорируется; звуки `factory_repair/break.ogg`); фаза 3 + все шкалы > 0 → фаза 4 и событие `refuel <имя>`;
* фаза 4 (не `enemy_factory`): шкала −= dt·100/resource_time/max_resource (ящик = resource_time), самая низкая не уходит ниже 0;
  раз за цикл анимации с `#bool gives_money` — деньги += `profit`, счётчик `sell <имя>` += 1; если шкал > 0 меньше трёх — фаза 3;
* в фазах 3–4 играет `<имя фабрики>.ogg` по кругу.

### Менеджер и светлячок
* `CManagerAI` (`sub_1003D794`): находит работника, ждущего оплаты (`sub_10006931`), и платит, если `деньги − цена покупки на курсоре ≥ pay`; иначе бродит;
* `CLightbugAI` (`sub_1003D49B`): порхает по сплайну вокруг «дома» (эллипс ~48×24 px, шаг параметра 0.1), при флаге следует за героиней (+140 px по y).

### Сценарные действия, свет и пчёлы (sub_1001B41C и соседи)
* **Солнце**: объект освещения (`sub_100178CE`): угол +300 (старт 90), цель +304, скорость +308 (°/мс), цвет +252/+268. `set sun "A T"` — угол → A за T мс (T=0 — сразу).
  `start day/morning/evening/night/moon T`: day 90° (1,1,1); morning 45° (0.82,0.92,1); evening 45° (1,0.92,0.82); night 15° (0.75,0.8,1); moon 15° (0.75,0.95,1).
  Ниже `#float sunset_angle` уровня (level +400) — ночной режим: lightmap (`bufferlightmap.tga`, `mask_light`), фонарь героини `flashlight2.tga`,
  `streetlamplight.tga`, `self_light.tga`. Порт рисует тьму оверлеем (коэффициент затемнения — подбор), см. `src/sim_sun.js`, `Renderer.drawLighting`.
* `level_time` хранится в мс (`×1000` при чтении), `sunset_angle` читается тем же загрузчиком свойств уровня (`sub_100234A6`).
* `visual effect sepia` — сепия на весь экран; `visual effect start truck` — Truck получает флаг +560 (уезжает), героиня скрывается (+192).
* `effect show <имя>` — у первого Obstacle с таким именем флаг +561 (показ эффекта). `house ready` — над Houses надпись «READY».
* `distract bees` — все пчёлы-работники (`CBeeAI`, `sub_1002FC5B`, эллипс 64×32 вокруг дома) получают дом = первое растение с готовым плодом +(32,32).
* `kill all people` — уничтожает всех Worker, у кого поле +9792 == 0. Поле +9792 = «летающий»: ставится в 1 только при создании AI пчелы (`CBeeAI`) и светлячка (`sub_1003D468`), у остальных 0. Итог: удаляются все персонажи класса Worker (guard, manager, waterboy, looser, нанятые работники), кроме bee/lightbug; героиня (класс Hero) не затрагивается; камера после этого центрируется на героине (`gameplay.center_on_worker`).
* `play/stop loop embient|music <файл>` — две независимые зацикленные дорожки (+348 ambient, +352 music).
* `center view <имя>` — камера центрируется на ближайшем к текущему центру экрана объекте с этим именем.

### Освещение и электричество — `EnvironmentLayer` (vftable 0x100934dc), `StreetLamp`, `CLevelStats`
* **EnvironmentLayer**: update `sub_10017535` (слот 17) двигает угол солнца (+300→+304 со скоростью +308) и цвет (+252→+268); яркость
  lightmap = `угол/90` (байты 248..251 = `angle/90·255`, при угле < 0 → 1). Draw `sub_10018483` (слот 16): очищает цвет неба `sun.color`
  (при sepia — тон `unk_100B053C`), рисует землю, затем RT `mask_light` (512×512 на весь экран, `bufferlightmap.tga`) умножается на сцену.
  Источники света в RT — аддитивно: фонарь героини `flashlight2.tga` (384×192), уличные фонари `streetlamplight.tga` (1024×512,
  у текстуры узкое ядро), `self_light.tga` 128×128 (ровный диск; Hero/Worker). Остальное в классе (`sub_10017C64`, `sub_10018112`) — редактор
  lightmap («Enable air brush», «Enable eraser», клавиши A/E/M/S, 0..9), в игре не используется.
* **Электричество** (`CLevelStats`, `sub_10026768`): +2068 (idx 517) = спрос — Σ `power_usage` фонарей (по умолчанию 1, `StreetLamp` ctor), +2072 (idx 518) =
  предложение — Σ `power_production` исправных генераторов (generator 3, big_generator 999; `overload generator` вычитает, `fix generator` прибавляет).
  Доля = 0 при предложении 0; 1 при спросе 0; иначе min(1, предложение/спрос).
* **Фонарь** (`StreetLamp::update`, `sub_100437FD`): при доле ≥ 0.01 отмечает освещёнными клетки сетки в области ±640 px вокруг себя (эллипс).
* **Работа в темноте** (`sub_10026858`, вызывается из поиска цели работников — `sub_100062F0`, `sub_10006B1C` и др.): если `sunset_angle` уровня < угла солнца —
  всё доступно; иначе цель доступна только при доле питания ≥ 0.4 и освещённой клетке (`sub_1001F04D`).
* Свойства уровня (`sub_100234A6`): `level_time` ×1000 (мс), `sunset_angle` (+400), `diablo_mode` (+415; уровни 3, 20 — управление героиней), `terramorphing` (+418; уровни 17, 19).

### Дождь и молния — `CRain` (update `sub_1002C62C`, молния `sub_1002C276`, радуга `sub_1002C504`, свойства `sub_1002CB1D`, ctor `sub_1002CDD4`)
* Дожди описаны `@rain` в guihost_scripts.txt (`testrain`, `heavyrain`, `monsoon_rain`, `mushroomrain`), у каждого вложен `@rainlightning` (plasma 64,36,36 ×18; halo белый ×6; light 36,36,64,64 ×128).
  Умолчания (ctor): strength 0/100/0, time begin/max/end 10000 мс, lightning вкл., период молний `lightning_strength_max` 9000 мс, rainbow вкл. (`rainbow_time` 10000), `end_sun_angle` 90.
* Фазы: −1 → солнце к `90 − strength_max·0.83` за `time_begin`; 0 — сила растёт begin→max; 1 — сила max (+ молнии); после `time_begin+time_max` солнце к `end_sun_angle`
  за `time_end`; 2 — сила падает max→end и (если есть) радуга `cos((t−tb−tm)/rainbow_time·π−π/2)·112/255`; затем счётчик `end rain` и объект уничтожается.
* Сила 0..100: прозрачность текстуры `rain.tga` = сила/100; прокрутка (текстурные единицы/мс): u −= (0.002·s+0.0002), v += (0.0015·s+0.00015), s = сила/100. Дождь **не поливает** растения сам — это делает сценарий (`water all`).
* Звук: `rainlight`/`rainmiddle`/`rainheavy` — петли; громкость `100 − |сила − пик|·3` % при пиках 33/66/99 и условиях сила < 66 / 33 < сила < 99 / сила > 66.
* Молния (только в фазе 1): раз в `lightning_strength_max` мс серия из rand(4) вспышек с интервалом 700 мс (первая через 500 мс); вспышка ставит текущий угол солнца 75° (затухает 0.2°/мс к цели),
  звук `thunder1.ogg` если осталось 3 вспышки, иначе `lightning.ogg`, 1–3 разряда (на 250 мс); конец непустой серии = счётчик `lightning strike`.

### Условия сценария, время, победа (sub_10018EC9, sub_100190C9, sub_1001901C, sub_1002198A, sub_100259AC)
* **Счётчики условий — на событие.** Каждое условие события имеет свой счётчик (+56) и растёт только пока событие взведено и включено
  (`sub_1001901C`: флаг +32 = 0 у события с `enabled by event`, пока его не включат; +40 — выполнено). Событие считает то, что произошло
  **после** его включения/создания. Состояния («сейчас») — `money`, `switches on`, `unpaid workers`, `jobless workers`, здоровье растений — берутся как есть.
  Порт: снимок накопительных счётчиков при включении события (`ev.base`), условие сравнивает разность (`World.condCounter`).
* **Время в мс.** `game time` = мс от старта уровня (поле +156), порог в скрипте тоже в мс (`>=420000` = 7 мин; `>=100` = «сразу»);
  `time` = мс с **создания** события (+36). Так на уровне 18 шаблон `l18_ahtung` повторяет поломку каждые 180 с. (Порт раньше сравнивал секунды —
  такие события не срабатывали.)
* **Таймер уровня.** `level_time` ×1000 (мс). Полоса времени = `1 − прошло/level_time`, не меньше 0. **Таймаута-поражения нет**: время вышло — просто нет золота
  (трофей, если `прошло ≤ level_time`). Поражение — только действие `defeat` (флаг +405 → `levelstatuschecker`), победа — `victory` (звук `victory.ogg`, флаг +404).
* **Конец уровня** (`sub_1002198A` при +404): `final_effect.ogg`, окно `level_complete_window` (время, level_time, лучшее; по умолчанию рекорд 359999 с),
  рекорд = min, файл сохранения `.lev` удаляется; после уровня 24 — комикс `comics24_pack`, иначе `levelmenu`.
* **HUD** (`sub_100259AC`): строки заданий «`%s: %i/%i`», для `time`/`game time` значения делятся на 1000; показываемые деньги догоняют настоящие шагом `разность/2` раз в 40 мс.
* `center view <имя>` (`sub_10021262`): камера едет к цели со скоростью 1 px/мс до 5 px.

### enemy_factory и отладочная клавиша фабрики (sub_10033906, sub_10032FA3, sub_100331D4)
* `#bool enemy_factory` (+6224) в данных второй части **нигде не встречается** — флаг не используется. В коде: при флаге в фазе 4 шкала не расходуется
  и счётчик `sell` не растёт; перенос фабрики-конкурента в порт не нужен.
* `sub_10032FA3` — обработчик клавиши (код 25 при событии 9): пошаговая отладочная смена фазы фабрики (`phase+1`, после 4 переключает флаг `enemy_factory`).
  В игре недоступна, игнорируем.

### Окно конца уровня (sub_10057912, sub_1005730F, sub_10057694, sub_100574FC, sub_100573F7, sub_1005E288)
* Форма `level_complete_form` (menuhost_scripts.txt): 260×280; тексты `caption` (жёлтый 18), `your_time`, `trophy_time`, `got_trophy` (зелёный 14), `record_time`, `got_record` (зелёный 14), кнопка `ok`. Формат времени `метка: ЧЧ:ММ:СС`, значение 359999 → `--:--:--`.
* Сообщение 26 (`sub_1002198A`): данные {время игры с, level_time с, прежний рекорд (359999, если не было)} → показ окна, старт автомата (`sub_1005730F`). Рекорд обновляется минимумом, `.lev` удаляется.
* Автомат (`sub_10057694` каждый кадр, `sub_100574FC` переход), длительности из таблицы по состоянию: 2=800, 3=300, 4=2000, 5=300, 6=800, 7=800, 8=300, 9=800, 10=800 мс:
  1→2 заголовок пульсирует (размер 18 + sin(π·t/T)·1.5); 3 пауза; 4 «ваше время» (показ, счёт от 0 до итога линейно за 2 с); 5 пауза, текст = итог;
  6 показ «золотое время»; 7 «трофей» (только если время ≤ level_time; пульс 14+sin·1.5); 8 пауза; 9 показ «рекорд»; 10 «новый рекорд» (если время < прежнего рекорда; пульс); 0 — конец.
  Во всех состояниях каждые 30 мс у заголовка вылетает частица `level_complete` (в порте не воспроизведена).
* Кнопка «ОК» (`sub_1005E288`): пока автомат идёт (сообщение 27 ≠ 0) — сообщение 28 (`sub_100573F7`) показывает итог сразу; иначе `levelstatuschecker` → меню уровней, а после `level24` — комикс `comics24_pack`.
* Порт: `src/ui.js` (`startComplete/tickComplete/advanceComplete/skipComplete`). Проверено в браузере: текст и порядок появления строк; визуальная пульсация и частицы не проверялись.

### Эффекты: `effect show`, свечение, `visual effect` (sub_1001B41C, sub_1003E195, sub_1003EEAE, sub_1003E3A3)
* `effect show <имя>` — у первого Obstacle с этим именем ставится флаг показа (+561). Сам по себе объект не меняется; рисуется свечение (`sub_1003E195`, если есть `glow_pos/glow_size` — флаг +562 ставится при их чтении).
  Используется: level12 `airplane_cockpit` (`#float delay 1000`), level24 `decor_altar` (после 15 грибов).
* Свечение: три текстуры `pictures/others/<имя>_glow1..3` (в оригинале .tga, у нас png), каждая рисуется квадом `(левый верх объекта + glow_pos, glow_size)` цветом белый·a, где
  `a_k = sin(speed_glow·T + k·2π/3)·0.5 + 0.5`, k = 0,1,2; `speed_glow` по умолчанию 0.005 (конструктор sub_1003E599), у cockpit 0.1; T — глобальное время кадра (мс, предполагается). Для верха
  выбрана интерпретация «левый верх» (у cockpit glow_pos 192,64 совпадает с дымом двигателя).
* Предметы `mobilephone` и `mushroom` (sub_1003F407/sub_1003F56E, флаги +528..530) всегда светятся 64×64 на самом предмете, speed 0.005, те же три текстуры (`sub_1003EEAE`).
* `visual effect`: `sepia` (весь экран) и `start truck` — других значений в коде нет (проверено по строкам sub_1001B41C); в данных встречаются только эти два.
* Порт: `Renderer.drawGlow` (src/render.js), аддитивное смешивание `lighter`, рисуется до прохода освещения (ночью свечение затемняется картой света — как оно в оригинале, не проверено).

### Светлячок (CLightbugAI): полёт по кривой и следование за героиней (sub_1003D49B, sub_1003F15F, sub_10012FF3, sub_10001C86)
* Поля AI: 4 контрольные точки (+4..+32, пары x,y), параметр t (+36), флаги +40 «инициализирован», +41 «дом лежит под предметом (Piece)», +42 «следует за героиней». Дом — поля +9916/+9920 работника (= точка появления).
* Вызывается, только когда у работника нет задания (`+7720 ≤ 0`; задания — шаги пути). Первый вызов: 4 точки на эллипсе 48×24 вокруг дома (угол — случайный в [−π, π], `sub_10012C32(a)` = случайное в [−a, a]),
  светлячок ставится в P1, `+41` = дом лежит на пикселях какого-либо Piece (проверка `vfunc+196` с маской 7).
* Каждый вызов: `t += 0.1`; цель = `spline(P0..P3, t)` — Catmull–Rom от P1 (t=0) до P2 (t=1) (`sub_10012FF3`); светлячок идёт к ней обычным движением работника (speed 60), после прибытия берётся следующая точка.
  При `t ≥ 1`: если `+42` — дом = позиция героини + (0, +140) (ниже героини); `t -= 1`; точки сдвигаются (P0←P1, P1←P2, P2←P3), новая P3 на эллипсе 64×32 вокруг (нового) дома.
* Следование включается в обработчике подъёма предмета Piece (`sub_1003F15F`, сообщение 0x4000, «take <имя>»): для каждого светлячка с `+41` и домом под этим предметом `+41=0, +42=1`, и задание прерывается (`sub_10001C86`).
* Порт: `updateLightbug`, `lightbugsFollow` (src/sim_people.js; вызов в sim.js при подъёме предмета), состояние `follow/nearPiece/home` сохраняется. Летит напрямую (препятствия не учитываются), «под предметом» = дом внутри рамки предмета (оригинал — по пикселям спрайта).

### Экран выбора уровней и комикс (interfaces/levelmenu.txt, comics.txt, guihost_scripts.txt; sub_1005BAF0, sub_1005C1BD)
* Полка уровней — `@toolbar levelselector`: pos 0,−256, 900×256, фон `downbar_levels.tga` 1024×256 (низ экрана); кнопки `@menulevelbutton` 58×58 (иконка, `lock`, `star` на всю кнопку, `number` pos −24,−15 справа кегль 12, рамка `bitmap_checked` 105 %), промежуток `indent` 4,
  центр по y = центр панели − `pitch` (−96 → y = 736 px), окно = 900 − 2·`scroll_margin` (36) = 828 px; видимая группа центрируется (`center_items`). Прокрутка по одному уровню (кнопки `back_scroll`/`forward_scroll` 32×64 на краях панели, pos 0,−102; колесо мыши); кнопка видна, только если есть уровни за краем.
  В `item_list` скрипта уровни 15 и 18 указаны дважды — в порте не дублируются. Стрелки-указателя над уровнем в оригинале нет.
* Комикс: `main_layer` = `comics1.jpg` с texcoord 0,0,0.78125,0.58594 (область 800×600 текстуры), растянутая на 1024×768; кадры и реплики заданы в координатах 1024×768; кнопки `skip` и `back` — pos 442,−329 (центр) 64×64, т.е. левый верх (922, 681).

## Доска заданий и надпись уровня (sub_100259AC, sub_1002ED4F)
* `upmenu_center` стартует на y=-98 и раз в 40 мс сдвигается на 1 px вниз к `-98 + 14·(число видимых строк целей)`;
  `task1` — нижняя строка (y=32), следующие выше на 14. Заливка `task_bar` (352·доля × 21, texcoord u 0..0.695·доля,
  v 0..0.781, слева направо) догоняет долю шагом 0.02 за тик, уменьшается сразу. Доля — выполненные цели / все
  (приближение: оригинал считает условия задания, `sub_1002EE54`).
* `level_name`: надпись начинается с x=196 окна (табличка под полосой времени), а не заканчивается там.
* Кадры комикса оригинал не озвучивает (в `comics.txt` только `music_comics.ogg`) — звук `selectmenu` убран.

## Растения части 2 (sub_10040C34)
* У `@plant` нет дочерних `@sprite`: конструктор создаёт анимации `plant_idle0..4` / `plant_growth0..3`
  (`animationhost_scripts.txt`: кадры 0 / 0–7, 8–15, 16–23, … 56–63, 8 кадров за 1 с) с листом `<texname|name>.tga`,
  размером кадра `frame_size` и сдвигом `delta_pos` самого растения. Порт рисовал только sprite-потомков (часть 1),
  поэтому растения и репейник не были видны вовсе; теперь рисуются по этой схеме.
* Полоса задания после выполнения целей дозаполняется до конца; новое задание начинает её с нуля.

## Озвучка, широкое меню, лопата
* `data/sounds/vo/*.ogg` — озвучка реплик комиксов (`comics_pXfYbZ`) и диалогов уровней (`lN_..._phraseK`); имя звука = ключ
  текста реплики (`soundhost_scripts.txt` @sample). Порт играет её при показе реплики и обрывает при переходе/пропуске;
  следующая реплика ждёт конца голоса.
* Главное меню (`menu.txt`): кроме фона 1024×768 есть полосы `wide_left/wide_right` (172×768 по бокам, pos ±598) —
  в окне 16:9 (1368 px) они продолжают комнату. Порт их рисует.
* Лопаты в инвентаре оригинала нет (кнопка — идея порта), текстуры нет — значок нарисован SVG в `ui.js`.
