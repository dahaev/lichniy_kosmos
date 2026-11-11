# Журналы экранов

Один файл на экран: `SCR-XX.md`. Процесс из 7 стадий — ARCHITECTURE_MVP_v2 §25 и `.cursor/rules/frontend-screen-workflow.mdc`. Стадия не закрыта, пока нет её артефакта.

## Шаблон `SCR-XX.md`

```markdown
# SCR-XX — <название>

Срез: <V1 | V2 | …>. Маршрут: `<path>`. Композиция сцены: `<name>`.

## 0. Спецификация
- Источники: SCREEN_SPEC §…, DESIGN_SYSTEM §…, MOTION_SPEC §…, FRONTEND_ACCEPTANCE §….
- Состояния: loading / empty / error / disabled / focus / …
- Каркасы по viewport (ASCII): 1440×900, 390×844, 768×1024, 1920×1080.
- Запросы `search.py` и выводы.
- Противоречия skills ↔ спецификации и как решены.

## 1. Интерфейс
- Компоненты, токены, моки MSW (эндпоинты из `api/openapi.yaml`).

## 2. Motion
| Элемент | Триггер | Свойства | Длительность / easing (токен) | Reduced motion |
|---|---|---|---|---|

## 3. Сравнение с эталоном
- Снимки: `e2e/visual/output/…`; mismatch по `summary.json`.
- Опорные точки (±2% viewport) и принятые отклонения.

## 4. Независимое ревью
- Critique: ссылка на снимок `.impeccable/critique/…`; DEGRADED или нет.
- Motion-ревью: Before / After / Why.

## 5. Исправления
- Что закрыто по critique.

## 6. Приёмка
- Vitest / Playwright / axe / клавиатура / reduced motion / fallback без WebGL / бюджеты.
- «Утверждено владельцем»: <дата> — или «не утверждено».
```
