# hero-landscape.temp-not-for-production.jpg

**Статус: временная пластина, не для production** (решение Q16, `docs/PROJECT_DECISIONS.md` п. 17). Заменяется финальным ассетом до среза 11 без изменения кода.

| Поле | Значение |
|---|---|
| Что | Фон первого экрана, landscape: небо, планета, свечение горизонта, горы, вода. Без текста, интерфейса, орбит и малых тел |
| Инструмент | Генерация изображений Cursor (`GenerateImage`), 2026-11-11 |
| Вход | `docs/frontend/references/hero-approved.png` как референс композиции. Эталон в ассет не копировался |
| Размер | 1280 × 720, JPEG |
| SHA-256 | `bfcbc38b63d920594009987cd68bfbdb2c16b65f22ce2778e78f789e748b93da` |
| Лицензия | Не проверена для коммерческого использования. Только для прототипа V1 и внутреннего ревью |
| Ограничения | Разрешение ниже бюджета §17.2c (мастер планеты ≥ 4096 px). На 1920 px изображение мягче эталона |

Отобранный вариант — первый из двух сгенерированных: у него верх планеты срезан краем кадра, как в эталоне.

## Промпт

> Recreate the background scene of the attached reference image as a clean, text-free cinematic matte painting plate, wide 16:9 landscape. Keep the exact same composition and camera: a huge photorealistic planet on the right side, its center at about 76% of the width and 34% of the height, its diameter about 60% of the image height, the top of the planet slightly cropped by the top edge; the planet's dark night side faces left toward the viewer, with a thin intense warm golden-orange rim light along its right and lower-right limb and soft amber atmospheric glow; subtle continent and cloud texture on the planet surface. Deep dark navy-blue night sky (#07111d to #0d1925) filling the whole left half, with sparse tiny faint stars, completely empty and calm on the left so text can be placed over it later. Lower part: a warm amber-orange glowing horizon with soft layered clouds behind a dark jagged mountain range on the right half, mountains fading into dusk haze toward the left, and a dark calm water surface at the very bottom reflecting the warm glow faintly. Moody, premium, editorial, filmic color grading, fine film grain. ABSOLUTELY NO text, no letters, no logos, no user interface, no buttons, no orbit lines, no rings, no ellipses, no moons or small planets, no bright dots, no frame or border, no watermark.

## Обработка при экспорте

`frontend/scripts/build-scene-plates.mjs` по `plates.config.json`: продолжение краёв, чтобы планету можно было поставить по размеру эталона без зазоров (слева — зеркало тёмного неба, справа — растяжка крайнего столбца, снизу — размытый средний тон воды без структуры), экспорт в AVIF и WebP. Цветокоррекция в скрипте есть, но в V1.1 выключена (`strength: 0`). Мастер не изменяется.
