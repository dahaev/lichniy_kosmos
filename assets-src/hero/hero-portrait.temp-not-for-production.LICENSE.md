# hero-portrait.temp-not-for-production.jpg

**Статус: временная пластина, не для production** (решение Q16, `docs/PROJECT_DECISIONS.md` п. 17). Заменяется финальным ассетом до среза 11 без изменения кода.

| Поле | Значение |
|---|---|
| Что | Фон первого экрана, portrait (mobile, tablet): планета в верхней части, тёмное небо под текст, горизонт внизу. Без текста, интерфейса, орбит и малых тел |
| Инструмент | Генерация изображений Cursor (`GenerateImage`), 2026-11-11 |
| Вход | `hero-landscape.temp-not-for-production.jpg` как референс палитры и планеты |
| Размер | 720 × 1280, JPEG |
| SHA-256 | `e2232c66382877ab5be89722a121abf1b27578dac8c43ea0b92f38a8f722761b` |
| Лицензия | Не проверена для коммерческого использования. Только для прототипа V1 и внутреннего ревью |
| Ограничения | Утверждённого mobile-эталона нет: композиция — предложение по DESIGN_SYSTEM §3 («на mobile планета уходит в верхнюю часть») |

## Промпт

> Tall 9:16 portrait version of the same scenery as the attached image, text-free cinematic background plate for a mobile screen. The same huge realistic planet with dark night side and bright golden-amber crescent rim light on its right limb sits in the upper part of the frame: center at about 70% of the width and 20% of the height, diameter about 95% of the image width, partly cut by the right and top edges. Below it, the middle of the frame is a calm deep dark navy-blue night sky with very sparse faint stars and only a hint of warm haze, dark enough for white text to sit on it. The bottom 22% of the frame: warm amber glow on the horizon with thin cloud streaks, a dark jagged mountain silhouette with a few sunlit peaks, and a dark lake at the very bottom with faint golden reflections. Same color palette and filmic grading as the attached image, fine film grain. Strictly no text, no letters, no UI, no buttons, no orbit lines, no rings, no moons, no extra planets, no frame, no watermark.

## Обработка при экспорте

`frontend/scripts/build-scene-plates.mjs`: только экспорт в AVIF и WebP (540 и 720 px), без продолжения краёв и без цветокоррекции. Мастер не изменяется.
