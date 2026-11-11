import type { components } from '@/api/schema'

type Place = components['schemas']['Place']

/**
 * Synthetic gazetteer for the intake prototype (SCR-02, slice V1.2): real
 * city names with rounded coordinates. The backend imports GeoNames in B1;
 * until then only these places exist.
 */
const rows: [id: string, name: string, region: string | null, country: string, lat: number, lon: number, tz: string, population: number][] = [
  ['ru-msk', 'Москва', null, 'Россия', 55.76, 37.62, 'Europe/Moscow', 13_000_000],
  ['ru-spb', 'Санкт-Петербург', null, 'Россия', 59.94, 30.31, 'Europe/Moscow', 5_600_000],
  ['ru-nsk', 'Новосибирск', 'Новосибирская область', 'Россия', 55.03, 82.92, 'Asia/Novosibirsk', 1_630_000],
  ['ru-ekb', 'Екатеринбург', 'Свердловская область', 'Россия', 56.84, 60.6, 'Asia/Yekaterinburg', 1_540_000],
  ['ru-kzn', 'Казань', 'Республика Татарстан', 'Россия', 55.79, 49.12, 'Europe/Moscow', 1_310_000],
  ['ru-nnv', 'Нижний Новгород', 'Нижегородская область', 'Россия', 56.33, 44.0, 'Europe/Moscow', 1_230_000],
  ['ru-chl', 'Челябинск', 'Челябинская область', 'Россия', 55.16, 61.4, 'Asia/Yekaterinburg', 1_190_000],
  ['ru-krs', 'Красноярск', 'Красноярский край', 'Россия', 56.01, 92.87, 'Asia/Krasnoyarsk', 1_200_000],
  ['ru-sam', 'Самара', 'Самарская область', 'Россия', 53.2, 50.15, 'Europe/Samara', 1_160_000],
  ['ru-ufa', 'Уфа', 'Республика Башкортостан', 'Россия', 54.74, 55.97, 'Asia/Yekaterinburg', 1_160_000],
  ['ru-rnd', 'Ростов-на-Дону', 'Ростовская область', 'Россия', 47.23, 39.72, 'Europe/Moscow', 1_140_000],
  ['ru-oms', 'Омск', 'Омская область', 'Россия', 54.99, 73.37, 'Asia/Omsk', 1_110_000],
  ['ru-krd', 'Краснодар', 'Краснодарский край', 'Россия', 45.04, 38.98, 'Europe/Moscow', 1_100_000],
  ['ru-vrn', 'Воронеж', 'Воронежская область', 'Россия', 51.67, 39.18, 'Europe/Moscow', 1_050_000],
  ['ru-prm', 'Пермь', 'Пермский край', 'Россия', 58.01, 56.25, 'Asia/Yekaterinburg', 1_030_000],
  ['ru-vgg', 'Волгоград', 'Волгоградская область', 'Россия', 48.71, 44.51, 'Europe/Volgograd', 1_000_000],
  ['ru-sar', 'Саратов', 'Саратовская область', 'Россия', 51.53, 46.03, 'Europe/Saratov', 900_000],
  ['ru-tmn', 'Тюмень', 'Тюменская область', 'Россия', 57.15, 65.53, 'Asia/Yekaterinburg', 850_000],
  ['ru-tlt', 'Тольятти', 'Самарская область', 'Россия', 53.51, 49.42, 'Europe/Samara', 680_000],
  ['ru-izh', 'Ижевск', 'Удмуртская Республика', 'Россия', 56.85, 53.2, 'Europe/Samara', 620_000],
  ['ru-brn', 'Барнаул', 'Алтайский край', 'Россия', 53.35, 83.78, 'Asia/Barnaul', 630_000],
  ['ru-irk', 'Иркутск', 'Иркутская область', 'Россия', 52.29, 104.28, 'Asia/Irkutsk', 610_000],
  ['ru-khv', 'Хабаровск', 'Хабаровский край', 'Россия', 48.48, 135.08, 'Asia/Vladivostok', 610_000],
  ['ru-yar', 'Ярославль', 'Ярославская область', 'Россия', 57.63, 39.87, 'Europe/Moscow', 570_000],
  ['ru-vvo', 'Владивосток', 'Приморский край', 'Россия', 43.12, 131.89, 'Asia/Vladivostok', 600_000],
  ['ru-mak', 'Махачкала', 'Республика Дагестан', 'Россия', 42.98, 47.5, 'Europe/Moscow', 620_000],
  ['ru-tom', 'Томск', 'Томская область', 'Россия', 56.48, 84.95, 'Asia/Tomsk', 570_000],
  ['ru-orb', 'Оренбург', 'Оренбургская область', 'Россия', 51.77, 55.1, 'Asia/Yekaterinburg', 560_000],
  ['ru-kem', 'Кемерово', 'Кемеровская область', 'Россия', 55.35, 86.09, 'Asia/Novokuznetsk', 550_000],
  ['ru-sch', 'Сочи', 'Краснодарский край', 'Россия', 43.6, 39.73, 'Europe/Moscow', 440_000],
  ['ru-kgd', 'Калининград', 'Калининградская область', 'Россия', 54.71, 20.51, 'Europe/Kaliningrad', 490_000],
  ['ru-mur', 'Мурманск', 'Мурманская область', 'Россия', 68.97, 33.07, 'Europe/Moscow', 270_000],
  ['ru-ykt', 'Якутск', 'Республика Саха (Якутия)', 'Россия', 62.03, 129.73, 'Asia/Yakutsk', 360_000],
  ['ru-kaz', 'Казачинское', 'Красноярский край', 'Россия', 57.7, 93.28, 'Asia/Krasnoyarsk', 4_000],
  ['by-msq', 'Минск', null, 'Беларусь', 53.9, 27.57, 'Europe/Minsk', 2_000_000],
  ['kz-ala', 'Алматы', null, 'Казахстан', 43.24, 76.89, 'Asia/Almaty', 2_200_000],
  ['kz-ast', 'Астана', null, 'Казахстан', 51.17, 71.43, 'Asia/Almaty', 1_350_000],
  ['ua-kie', 'Киев', null, 'Украина', 50.45, 30.52, 'Europe/Kyiv', 2_900_000],
  ['uz-tas', 'Ташкент', null, 'Узбекистан', 41.31, 69.28, 'Asia/Tashkent', 2_900_000],
  ['am-evn', 'Ереван', null, 'Армения', 40.18, 44.51, 'Asia/Yerevan', 1_090_000],
  ['ge-tbs', 'Тбилиси', null, 'Грузия', 41.72, 44.79, 'Asia/Tbilisi', 1_200_000],
  ['de-ber', 'Берлин', null, 'Германия', 52.52, 13.4, 'Europe/Berlin', 3_700_000],
  ['us-nyc', 'Нью-Йорк', 'Нью-Йорк', 'США', 40.71, -74.01, 'America/New_York', 8_300_000],
  ['ru-pnz', 'Пенза', 'Пензенская область', 'Россия', 53.2, 45.0, 'Europe/Moscow', 500_000],
  ['ru-pkc', 'Петропавловск-Камчатский', 'Камчатский край', 'Россия', 53.02, 158.65, 'Asia/Kamchatka', 160_000],
]

export const places: Place[] = rows
  .sort((a, b) => b[7] - a[7])
  .map(([id, name, region, country, latitude, longitude, timezone]) => ({
    id,
    name,
    ...(region ? { region } : {}),
    country,
    latitude,
    longitude,
    timezone,
  }))

/** Case- and ё-insensitive, so «орел» finds «Орёл» as the real index will. */
export function normalizePlaceQuery(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/g, ' ')
}

/** Prefix of the name or of any word in it («петербург» finds Санкт-Петербург); larger cities first. */
export function searchPlaces(query: string, limit = 20): Place[] {
  const q = normalizePlaceQuery(query)
  if (q.length < 2) return []
  return places
    .filter((place) => {
      const name = normalizePlaceQuery(place.name)
      return name.startsWith(q) || name.split(/[\s-]/).some((word) => word.startsWith(q))
    })
    .slice(0, limit)
}
