<!-- Файл генерируется tools/check_levels.mjs (задача 1) — не править руками. -->

# Типы действий и условий уровней части 2

Полный список значений `#string type` из `@action`/`@condition` всех уровней `assets/scripts/level1..24.txt`
(+ `_entry`; сливает их `src/data.js`). «sim.js» — текущее состояние движка порта:
`да` — действие выполняется уже сейчас, `нет` — кандидат для задач 4–6 (симуляция и сценарии).

## Действия (@action) — 46 типов, 4733 вхождений

| тип | сколько раз | уровни | понимает sim.js |
|-----|------------|--------|-----------------|
| `add to field` | 3035 | все 24 | да (задача 4: data "obj x y [arg]", arg — no_fruits / апгрейд дома / тэг персонажа / near_hero) |
| `add bed` | 631 | 1, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 15, 18, 19, 21, 22 | да (задача 4: data "x y w h [plant]"; счётчик dig_bed не растёт — это расстановка, не работа героини) |
| `add to shop` | 493 | 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 18, 19, 21, 22, 23 | да |
| `add dialogue` | 194 | все 24 | да (задача 6: ui.js showDialogue, очередь кадров simple_dialogue) |
| `set upgrade` | 63 | 2, 5, 7, 8, 9, 10, 11, 13, 15, 17, 18, 19, 21, 23 | да (задача 4: уровень хранится на объекте, счётчик upgraded_<имя>_<уровень>; визуал/эффекты — задача 5) |
| `delete from shop` | 58 | 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 21, 22 | да (задача 4) |
| `add guard waypoint` | 31 | 3, 20 | да (задача 5: sim_people.js, патруль охраны по тэгу) |
| `victory` | 26 | все 24 | да |
| `center view` | 22 | 2, 3, 4, 6, 10, 11, 16, 20, 21, 24 | да (Renderer.centerOnObject: камера едет к ближайшему объекту, 1 px/мс; IDA) |
| `upgrade factory` | 20 | 6, 7, 10, 11, 21 | да (задача 4, как set upgrade; поведение фабрик — задача 5) |
| `allow action` | 19 | 1, 3, 12, 14, 20, 22 | да (задача 4: "dig|plant|weed|harvest|water|fertilize|sell|switch|fix 0|1", начальное состояние — #bool cant_* уровня) |
| `set money` | 18 | 1, 2, 7, 8, 9, 10, 11, 13, 15, 17, 18, 19, 21, 23 | да |
| `play sound` | 17 | 12, 22 | да (задача 4) |
| `add event from pattern` | 15 | 3, 15, 18, 19 | да (задача 4: @pattern создаёт событие в рантайме) |
| `set plant thirst` | 13 | 2, 15, 21, 22 | да (задача 4: свойство уровня plant_thirst_growth) |
| `set sun` | 8 | 3, 13, 14, 16, 18, 22, 24 | да (sim_sun.js: угол солнца, цвет, затемнение; IDA) |
| `overload generator` | 7 | 3, 12, 14, 18, 20, 21 | да (задача 4: генератор становится broken) |
| `add money` | 6 | 2, 4, 5, 6, 21, 22 | да |
| `clear guard waypoints` | 5 | 20 | да (задача 5: sim_people.js) |
| `add particles` | 4 | 1, 22 | да (формат data совпадает) |
| `open shop tab` | 4 | 2, 4, 22 | частично (задача 4: вызов hooks.openShopTab; вкладки магазина — задача 2/6) |
| `kill all people` | 4 | 3, 8, 14 | да (все Worker кроме bee/lightbug) |
| `start morning` | 4 | 12, 19, 21 | да (sim_sun.js: угол солнца, цвет, затемнение; IDA) |
| `start night` | 3 | 12, 19, 20 | да (sim_sun.js: угол солнца, цвет, затемнение; IDA) |
| `start rain` | 3 | 15, 21 | да (sim_rain.js: CRain из IDA — фазы, сила, радуга, молнии, звук) |
| `water all` | 3 | 15, 21 | да (задача 4) |
| `set fruit growth` | 3 | 22 | да (задача 4: свойство уровня plant_fruit_growth) |
| `visual effect` | 2 | 3, 22 | частично (задача 5: счётчик effect_*, без отдельной анимации) |
| `upgrade house` | 2 | 5 | да (задача 4, как set upgrade) |
| `spawn object` | 2 | 6 | да (задача 4: предмет появляется у respawn, подбор даёт "take from respawn") |
| `effect show` | 2 | 12, 24 | частично (задача 5: счётчик effect_*, без отдельной анимации) |
| `start moon` | 2 | 24 | да (sim_sun.js: угол солнца, цвет, затемнение; IDA) |
| `show help` | 1 | 1 | да |
| `set plant health` | 1 | 2 | да (задача 4: свойство plant_starting_health + здоровье живых растений; семантика оригинала не восстановлена — open-questions) |
| `house ready` | 1 | 2 | частично (задача 5: счётчик effect_*, подсветки нет) |
| `show message` | 1 | 3 | да |
| `reset guards` | 1 | 3 | да (задача 5: sim_people.js) |
| `set hero pos` | 1 | 3 | да (задача 4) |
| `(без типа)` | 1 | 11 | да (задача 4: data — имя диалога → hooks.showDialogue, иначе событие помечается выполненным) |
| `fix generator` | 1 | 14 | да (задача 4: счётчик fixed_generator) |
| `start day` | 1 | 19 | да (sim_sun.js: угол солнца, цвет, затемнение; IDA) |
| `start evening` | 1 | 19 | да (sim_sun.js: угол солнца, цвет, затемнение; IDA) |
| `defeat` | 1 | 20 | да |
| `set plant growth` | 1 | 22 | да (задача 4: свойство уровня plant_growth) |
| `distract bees` | 1 | 22 | частично (задача 5: флаг world.beesDistracted) |
| `play loop music` | 1 | 24 | частично (задача 5: hooks.playMusic, если есть) |

## Условия (@condition) — 154 типов, 493 вхождений

| тип | сколько раз | уровни | понимает sim.js |
|-----|------------|--------|-----------------|
| `enabled by event` | 138 | 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `disabled by event` | 26 | 4, 6, 8, 14, 15, 18, 20, 21, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place harvester` | 15 | 4, 5, 6, 7, 8, 10, 13, 15, 17, 19 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place waterboy` | 15 | 4, 5, 6, 7, 8, 10, 13, 15, 17, 19 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place herder` | 13 | 5, 6, 7, 8, 10, 13, 15, 17, 19 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place helper` | 13 | 5, 6, 7, 8, 10, 13, 15, 17, 19 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `take fake_fertilizer` | 11 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `time` | 10 | 14, 18, 19, 21 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `dig bed` | 9 | 1, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `enter marker` | 9 | 3, 14, 16, 20, 24 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `money` | 8 | 4, 7, 8, 18, 21, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place manager` | 8 | 7, 8, 9, 11, 13, 19 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell factory_sausage` | 8 | 10, 11, 17, 19, 21, 23 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place factory_sausage` | 6 | 17, 19, 21 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place house_pig` | 5 | 5, 7, 10, 13, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell house_chicken` | 5 | 5, 8, 11, 13, 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `plants watered` | 4 | 2, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell house_sheep` | 4 | 2, 8, 13, 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell house_beehive` | 4 | 4, 6, 8, 13 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell house_pig` | 4 | 5, 11, 13, 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place house_chicken` | 4 | 7, 10, 13, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell factory_clothes` | 4 | 11, 19, 23 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place watercan` | 4 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_tomato` | 3 | 1, 15, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell plant_tomato` | 3 | 1, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell house_cow` | 3 | 5, 11, 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place house_sheep` | 3 | 7, 13, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place house_cow` | 3 | 7, 10, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell factory_sweeties` | 3 | 21, 23 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `harvest plant_tomato` | 2 | 1, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place box` | 2 | 1, 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_carrot` | 2 | 2, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `plants fertilized` | 2 | 2, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `arrested` | 2 | 3, 20 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `game time` | 2 | 3, 20 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place hangar_refrigerator` | 2 | 4, 5 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_cabbage` | 2 | 5, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_wheat` | 2 | 5, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_cow 1` | 2 | 5, 10 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_chicken 1` | 2 | 5, 10 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_cow 2` | 2 | 5, 7 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `jobless workers` | 2 | 9 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_pig 3` | 2 | 13, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_chicken 3` | 2 | 13, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_sheep 3` | 2 | 13, 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `switches on` | 2 | 14, 20 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `take mobilephone` | 2 | 14, 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end rain` | 2 | 15, 21 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `take map_piece` | 2 | 16 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place factory_clothes` | 2 | 19 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_water_ok` | 2 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `take mushroom` | 2 | 24 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `kill plant_bur` | 1 | 1 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l1_weeding_by_scenario_dialog` | 1 | 1 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l1_victory_dialog` | 1 | 1 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell tree_pear` | 1 | 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell tree_peach` | 1 | 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place seed_carrot` | 1 | 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell plant_carrot` | 1 | 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_sheep 1` | 1 | 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `feed house_sheep` | 1 | 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l2_victory_dialog` | 1 | 2 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l3_restart_by_scenario_dialog` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `steal big_fertilizer` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `steal seed_orchid` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `steal tree_grapes` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `steal plant_cucumber` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `steal tree_pineapple` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `all switches on` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l3_victory_by_scenario_dialog` | 1 | 3 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l4_destroy_trash_dialog` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `store deny hangar_vegetables` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell tree_banana` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `transported hangar_vegetables` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_dahlia` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `kill decor_bog` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `kill decor_brokentree` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_rose` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place house_beehive` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l4_victory_dialog` | 1 | 4 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l5_dialogue9` | 1 | 5 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place hangar_flowers` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `kill plant_orchid` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell plant_orchid` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place patent_for_dahlia` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place patent_for_sunflower` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell plant_dahlia` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell plant_sunflower` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell tree_plum` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell tree_raspberrybush` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_strawberries` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l6_victory` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l6_buy_1st_worker` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `take from respawn` | 1 | 6 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_pig 2` | 1 | 7 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_chicken 2` | 1 | 7 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_sheep 2` | 1 | 7 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l7_victory` | 1 | 7 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue` | 1 | 7 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place water_sprinkler` | 1 | 8 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l8_victory` | 1 | 8 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l9_victory` | 1 | 9 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_pig 1` | 1 | 10 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l10_victory` | 1 | 10 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `refuel factory_sausage` | 1 | 11 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `refuel factory_clothes` | 1 | 11 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `(без типа)` | 1 | 11 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l11_victory` | 1 | 11 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `take spare` | 1 | 12 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `fixed generator` | 1 | 12 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l12_pilot_1` | 1 | 12 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l12_pilot_2` | 1 | 12 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_lily` | 1 | 12 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l12_wait_for_morning` | 1 | 12 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l12_saved` | 1 | 12 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place generator` | 1 | 13 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place streetlamp` | 1 | 13 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l13_victory` | 1 | 13 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l14_victory` | 1 | 14 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l14_dumb_victory` | 1 | 14 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `thirsty plants` | 1 | 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_beetroot` | 1 | 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_corn` | 1 | 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place megawaterpump` | 1 | 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `upgraded house_cow 3` | 1 | 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l15_victory` | 1 | 15 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l16_victory` | 1 | 16 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place terra_irrigator` | 1 | 17 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l17_victory` | 1 | 17 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell plant_onion` | 1 | 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sell plant_mushroom` | 1 | 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l18_victory` | 1 | 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l18_victory2` | 1 | 18 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l19_victory` | 1 | 19 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l20_start` | 1 | 20 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l20_victory` | 1 | 20 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l20_got_caught` | 1 | 20 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `place big_generator` | 1 | 21 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l21_victory` | 1 | 21 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `lightning strike` | 1 | 21 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `sow seed_lsd` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_plant_tomatoes` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_find_treasure` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue treasure_hunt_end` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_third_watering` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_where_is_phone` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_summon_daemon` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_wtf` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `take big_fertilizer` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_bees_summoned` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `fruit ready plant_dahlia` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l22_victory` | 1 | 22 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l23_victory` | 1 | 23 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |
| `end dialogue l24_victory` | 1 | 24 | да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги) |

## Особые узлы сценариев части 2

| узел | смысл |
|------|-------|
| `@event` | группа условий + действий; действия выполняются, когда истинны все условия события (без условий — сразу; так живёт `default placement` из `_entry`) |
| `@pattern` | именованный шаблон события; в рантайме создаётся действием `add event from pattern` (перезапускаемые цепочки: дождь L15, время суток L19, охрана L3) |
| `#bool player_task` на `@event` | событие показывается игроку как задание (панель задач) |
| `@action` без `type` | data — имя диалога (показать диалог) или события (пометить выполненным); level11 `l11_export` (точная семантика оригинала неизвестна, см. open-questions.md) |
| `@condition` без `type` | истинно, когда выполнены все перечисленные через запятую события (data; level11) |

Расстановка поля: события из `levelN_entry.txt` (`default placement`) вставляются в сценарий
на место ссылки `[levelN_entry]` — первыми, как в оригинале. Данные `add to field` — `obj x y`
(координаты внутри data, в части 1 было `#point coords`), `add bed` — `x y w h [plant]`.

