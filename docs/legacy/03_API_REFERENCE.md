# Личный космос: справочник серверного API

Версия исходников: **0.13.4**. Дата сверки: **10.11.2026**. Редакция 2: выбранные маршруты самостоятельного сайта из регистраций `HandleFunc` в `internal/app`. Это справочник веб-контура, а не всех компонентов исходного архива и не подтверждение включённых production-функций.

## 1. Как читать справочник

| Обозначение | Значение |
|---|---|
| Public | Пользовательская сессия не нужна; остаются Origin/валидация/лимиты |
| Session | Нужна действующая сессия; доступ к объекту проверяется по её владельцу |
| Account | Нужен активный почтовый аккаунт `acct:` |
| Owner | Нужны сессия и действующая роль владельца из БД |
| Capability | Доступ по отдельному ограниченному ticket; это не API-сессия |
| Bank | Подпись банка и серверная проверка; не пользовательская авторизация |
| Web | Самостоятельный сайт `APP_MODE=web` |
| Demo | Только явный `ALLOW_DEMO_AUTH=true` вместе с `DEMO_GENERATION=true`, где это предусмотрено |

`W+A` означает Web с включёнными accounts. В executable 0.13.4 accounts автоматически включены при Web. Для описанных сценариев используется `APP_MODE=web`. Веб-поддержка и банковские продажи дополнительно зависят от своих настроек.

Обычные JSON-запросы до 16 KiB, неизвестные поля запрещены. Для записывающих `/api/*` нужен `Origin: <APP_ORIGIN>`, кроме `/api/bank/notification`. Авторизация — `Authorization: Bearer <session_token>` или `natal_session` cookie.

`Idempotency-Key` для соответствующих операций — 16–80 символов `[a-zA-Z0-9_-]`. Это не одноразовый пароль и не код доступа. Его следует сохранять для повтора той же операции; изменение данных с прежним ключом может возвращать конфликт.

GET-паттерны Go ServeMux также обслуживают HEAD. Ответы обычных API — JSON; скачивание и банковское подтверждение имеют указанные ниже форматы.

## 2. Системные данные, вход и публичный каталог

| Метод и путь | Доступ / режим | Ввод | Результат и поведение |
|---|---|---|---|
| `GET /healthz` | Public | — | 200, `{status:"ok"}`; это liveness HTTP-процесса |
| `GET /api/config` | Public | — | auth_mode, demo, accounts_enabled, email_login_available |
| `POST /api/session` | Public, Web | `{}` | Восстановление web-cookie; метаданные и при наличии входа session_token |
| `GET /api/me` | Session | — | Метаданные текущего режима, доступность функций, роль владельца; в Web — сведения активного кабинета |
| `POST /api/web/login` | Public, Web | `{code}` | Кодовая сессия, метаданные и order_id существующего результата; вход не расходует код |
| `POST /api/web/owner` | Public, Web | `{key}` | Отдельная сессия владельца после проверки ключа и роли |
| `POST /api/logout` | Public | — | Удаляет cookie; `{ok:true}` |
| `GET /api/catalog` | Public | — | Массив Product с available, includes, inputs и slug |
| `GET /api/catalog/{slug}` | Public | Slug в пути | Product либо 404; карточка анонса тоже может существовать |

Источники: `server.go:200`, `web.go:24`, `catalog.go:24` в `internal/app`.

## 3. Почтовый аккаунт и права на услугу

| Метод и путь | Доступ / режим | Ввод | Результат и поведение |
|---|---|---|---|
| `POST /api/account/login/request` | Public, W+A | `{email}` | 200, challenge_id, expires_at, retry_after_seconds; SMTP недоступен → 503 |
| `POST /api/account/login/verify` | Public, W+A | `{challenge_id,code}` | Проверка шестизначного OTP; метаданные, cookie и session_token |
| `GET /api/account/access` | Account, W+A | — | Список AccountAccess этого аккаунта, включая состояние и order_id |
| `POST /api/account/codes/claim` | Account, W+A | `{code}` | Привязывает разрешённый код к аккаунту, возвращает AccountAccess; другая принадлежность → 409 |
| `GET /api/account/access/{id}/draft` | Account, W+A | ID доступа | `{profile: Profile|null}` после проверки принадлежности |
| `PUT /api/account/access/{id}/draft` | Account, W+A | Profile | Валидирует и сохраняет анкету доступной ещё не использованной услуги |
| `POST /api/account/access/{id}/orders` | Account, W+A | `{profile,consent_version,generate}` + Idempotency-Key | 201 новый Order / 200 прежний; при generate возможно сразу поставить в очередь |
| `POST /api/account/demo` | Session, W+A, Demo | — | Создаёт синтетический почтовый аккаунт и переключает сессию; production → 404 |
| `POST /api/account/demo-access` | Account, W+A, Demo | — | 201, тестовый AccountAccess; production → 404 |

Действующая web-версия согласия возвращается в метаданных сессии. Повторное создание заказа по использованному доступу с другой анкетой → 409. Для создания проверяются существование доступа, его продукт и владелец ещё до локального расчёта.

Источник: `internal/app/account_http.go:37`.

## 4. Места, анкета и создание заказа по коду

| Метод и путь | Доступ / режим | Ввод | Результат и поведение |
|---|---|---|---|
| `GET /api/cities` | Session | Query `q` | До 20 мест; q до 100 Unicode-символов/512 байт |
| `GET /api/cities/{id}` | Session | ID места: legacy или geonames | Проверенное место; несуществующее → 404 |
| `POST /api/demo-code` | Session, demo generation | — | 201, `{code}`; реальные продажи этим endpoint не создаются |
| `POST /api/codes/check` | Session | `{code}` | `{valid:true,order_id}`; в Web проверяет разрешённый web-код |
| `GET /api/draft` | Session | — | `{profile: Profile|null}` прежнего пользовательского черновика |
| `PUT /api/draft` | Session | Profile | Валидирует и сохраняет прежний пользовательский черновик |
| `POST /api/orders` | Session, допустимый кодовый сценарий | `{code,profile,consent_version,generate}` + Idempotency-Key | 201 новый / 200 существующий Order; расход права и сохранение заказа транзакционны |

Почтовый кабинет использует отдельные access-маршруты предыдущего раздела. Прежние draft/order endpoints не следует подменять ими без адаптации принадлежности и контрактов.

Источник: `internal/app/server.go:361`.

## 5. Результаты и генерация

| Метод и путь | Доступ | Ввод | Результат и поведение |
|---|---|---|---|
| `GET /api/orders` | Session | — | Свои сохранённые Order; не запускает генерацию |
| `GET /api/orders/{id}` | Session | ID заказа | Свой Order, состояние и can_generate; чужой → 404 |
| `POST /api/orders/{id}/generate` | Session + право на этот заказ | `{consent_version,acknowledge_repeat}` | 202, состояние Order; повтор активного/готового не создаёт второй этап; недопустимое продолжение → 409 |
| `GET /api/orders/{id}/illustration.png` | Session | Необязательный query `download=1` | PNG сохранённой персональной иллюстрации, inline/attachment |
| `GET /api/orders/{id}/report.txt` | Session | ID заказа | TXT принятого текста; картинка может быть ещё не готова |
| `GET /api/orders/{id}/report.pdf` | Session | ID заказа | Локально собранный/кэшированный PDF; нужен полный комплект материалов |
| `GET /api/orders/{id}/illustration.svg` | Session | ID заказа | Демонстрационная SVG-графика, не персональный PNG |
| `POST /api/orders/{id}/download` | Session | `{kind}`: `report.txt`, `report.pdf`, `illustration.png` | `{url,file_name,expires_at}` на один формат, TTL 5 минут |
| `GET /downloads/{ticket}` | Capability | Подписанный ticket | Один сохранённый файл; срок и принадлежность проверяются; нет доступа к остальному API |
| `OPTIONS /downloads/{ticket}` | Public preflight | — | 204; GET/HEAD/OPTIONS ограниченного файлового endpoint |

`acknowledge_repeat` не разрешает неопределённый платный повтор клиенту сайта/кабинета. Это нельзя трактовать как универсальную кнопку «генерировать заново».

Источники: `internal/app/server.go:218`, `internal/app/generation.go:71`, `internal/app/download.go:78`, `internal/app/pdf.go:92`.

## 6. Магазин, банковская покупка и проверка оплаты

Все маршруты раздела — W+A. Возврат браузера на `/checkout/<id>` является frontend-навигацией, а не подтверждением списания.

| Метод и путь | Доступ | Ввод | Результат и поведение |
|---|---|---|---|
| `GET /api/shop` | Public | — | Цена в копейках, sales_ready, test, сведения продавца и ссылки условий |
| `POST /api/shop/quote` | Public | `{items:[{product_id,quantity}]}` | Quote с серверной суммой, RUB, revision и terms_version; может рассчитывать предложение при известных ценах без открытия продаж |
| `GET /api/admin/shop` | Owner | — | `{config,checks,ready}` |
| `PUT /api/admin/shop` | Owner | ShopConfig с текущей revision | Новая revision; оптимистическая проверка настроек; включение требует prerequisites |
| `POST /api/checkout` | Account | `{items,revision,terms_version,accept_terms}` + Idempotency-Key | 201 новый checkout, 200 существующий или 202 при неопределённом Init; пользовательскую сумму не принимает |
| `GET /api/checkouts` | Account | — | Собственные покупки, до 100 последних |
| `GET /api/checkouts/{id}` | Account | ID checkout | Только собственный Checkout |
| `POST /api/checkouts/{id}/refresh` | Account | ID checkout | Серверная проверка GetState по сохранённому payment ID, если он известен |
| `GET /api/admin/checkouts` | Owner | — | Последние checkout всех покупателей в клиентском представлении Checkout |
| `POST /api/admin/checkouts/{id}/reconcile` | Owner | `{payment_id}`; можно пустую строку при известном сохранённом ID | Проверить платёж через банк; terminal/test должны совпасть |
| `POST /api/bank/notification` | Bank | Банковский JSON с Token, OrderId, PaymentId, TerminalKey, Amount, Status и др. | Проверка подписи и состояния, транзакционная выдача/блокировка прав; успех — текст `OK` |
| `POST /api/demo/checkouts/{id}/confirm` | Account, Demo + demoBank | ID checkout | Подтверждение имитации без денег; production → 404 |

`ShopConfig`: enabled, price_kopeks, revision, seller, support_email, terms_version, terms_url, privacy_url, taxation, tax, payment_object, payment_method, fiscal_ready, updated_at. Поддержан только полный расчёт `full_payment`; допустимые значения валидируются сервером.

Источники: `internal/app/shop_http.go:22`, `internal/app/shop.go:21`, `internal/sitepay/bank.go`.

## 7. Реестр владельца и CSV

Для работы с шифрованными значениями дополнительно нужен исправный CodeService и подходящий CODE_VAULT_KEY. Общий доступ Owner не заменяет эту проверку.

| Метод и путь | Доступ / режим | Ввод | Результат и поведение |
|---|---|---|---|
| `GET /api/admin/codes/summary` | Owner | — | Счётчики состояний, партий, legacy и готовность реестра |
| `GET /api/admin/batches` | Owner | — | Партии и их счётчики |
| `POST /api/admin/batches` | Owner | `{label,product_id,count}` + Idempotency-Key | 201, Batch; count 1–500 |
| `POST /api/admin/batches/{id}/enable-web` | Owner, Web | ID партии | `{count}` переведённых prepared → issued; web_enabled=true |
| `POST /api/admin/codes/search` | Owner | `{query,batch_id,state,source,offset,limit}` | `{entries,total}`; limit по умолчанию 50, максимум 100 |
| `POST /api/admin/codes/{id}/reveal` | Owner | ID кода | `{code}` после расшифровки и аудита; не для legacy HMAC |
| `POST /api/admin/codes/{id}/block` | Owner | `{reason}` | `{count}`; только неиспользованные prepared/issued |
| `POST /api/admin/batches/{id}/block` | Owner | `{reason}` | Блокировка prepared/issued в партии, отзыв её выгрузок |
| `POST /api/admin/batches/{id}/export` | Owner | ID партии | `{url,file_name,expires_at,count}` для CSV prepared/issued |
| `GET /api/admin/audit` | Owner | — | Последние 30 событий кодового реестра |
| `GET /api/admin/roadmap` | Owner | — | Встроенный JSON плана; не история исполнения работ |
| `GET /admin-downloads/{ticket}` | Capability + живая роль создавшего владельца | 64-hex ticket | CSV; срок 5 минут, не требует cookie загрузчика |
| `OPTIONS /admin-downloads/{ticket}` | Public preflight | — | 204, заголовки загрузчика |

Источники: `internal/app/codes.go:49`, `internal/accesscodes/service.go`, `internal/accesscodes/export.go`.

## 8. Поддержка

| Метод и путь | Доступ / режим | Ввод | Результат и поведение |
|---|---|---|---|
| `GET /api/web/support` | Session, Web | — | Собственные сохранённые WebTicket |
| `POST /api/web/support` | Session, Web | `{message,order_id}` + Idempotency-Key | 201 WebTicket; message 5–3000 символов, необязательный свой заказ |
| `GET /api/admin/web-support` | Owner, Web | — | Сохранённые веб-обращения всех пользователей |
| `POST /api/admin/web-support/{id}/reply` | Owner, Web | `{reply}` | 200 `{ok:true}`; 1–5000 символов; обновляет поле ответа |

Показ формы зависит от сборки frontend: при выбранном внешнем контакте форма скрыта. Здесь описан путь через веб-форму. Без сессии можно читать справку, но нельзя сохранить обращение.

Источники: `internal/app/web_support.go:28`, `internal/app/web_support_store.go`, `frontend/src/WebSupport.vue`.

## 9. Посещения и статистика

| Метод и путь | Доступ / режим | Ввод | Результат и поведение |
|---|---|---|---|
| `POST /api/site/visit` | Public, Web | `{consent,id,visitor,visit,page,source,device}` | Обычно 204; валидирует разрешённые категории, исключает владельца/DNT/GPC/известных ботов, дедуплицирует |
| `GET /api/admin/statistics` | Owner, Web | Query `days=1|7|30|90`, default 7 | Агрегаты посещений, регистраций, состояний разборов, daily, pages/sources/devices |

ID события, visitor и visit должны быть 32-hex. Сервер сохраняет их HMAC; полные URL, данные анкеты и произвольные названия страниц не принимаются. Ввод consent=false не создаёт запись. Статистическая ошибка не должна останавливать основной пользовательский сценарий frontend.

Источник: `internal/app/statistics.go:136`.

## 10. Общие модели ответа

### Profile

```json
{
  "name": "Тестовый пользователь",
  "birth_date": "1990-01-01",
  "birth_time": "12:00",
  "time_unknown": false,
  "time_source": "approximate",
  "accuracy_minutes": 30,
  "city_id": "moscow"
}
```

Это синтетический пример контракта, не данные клиента. Для неизвестного времени сервер очищает birth_time, меняет time_source на unknown и accuracy_minutes на 0.

### Order

Клиент получает id, access_id/product_id при наличии, profile, city, status, report, chart, created_at, consent_version, generation и в ряде ответов can_generate. Внутренние user_id, code_hash, idempotency_key и fingerprint не входят непосредственно в JSON Order.

### Generation

stage, message, retryable, uncertain, image_ready, attempts, consent_version, started_at, updated_at. Статус нельзя трактовать отдельно от флагов и уже готового Report. В клиентских ответах Web диагностические сообщения при ошибке заменяются понятным следующим действием.

### Report

kind, summary, sections `[{title,text}]`, questions; для ИИ-результата также grounding, sources, visual_concept, symbols и word_count. Внешняя JSON Schema модели с paragraphs/source_ids нормализуется в этот внутренний формат — это разные структуры.

### Checkout

id, items, total_kopeks, currency, state, payment_url при наличии, access_ids, test, created_at, updated_at. Приватные terminal/email/payment metadata хранятся отдельно в storedCheckout и не являются полями обычного ответа Checkout.

### Версии согласий в этой версии

| Контекст | Константа |
|---|---|
| Web и почтовые доступы | `2026-11-web-generation-v2` |

Frontend должен использовать версию, возвращённую сервером, а не безусловно отправлять строку из документа после будущего обновления.

## 11. Маршруты интерфейса, fallback и полнота перечня

В ServeMux также зарегистрированы два catch-all:

| Паттерн | Функция |
|---|---|
| `/api/` | Для неизвестного API-пути вернуть 404 JSON |
| `/` | GET/HEAD frontend/static с SPA fallback; прочие методы отклоняются |

Адреса `/services`, `/account`, `/account/reports/<id>`, `/owner/*`, `/journal/*`, `/checkout/<id>` — навигация SPA, а не дополнительные backend-эндпоинты. HTML и реальные `/assets/*` отдаёт API под Caddy.

В выбранном веб-контуре перечислены **66 явных HTTP-паттернов**, включая два OPTIONS, и два общих fallback. HEAD, автоматически поддерживаемый GET-паттернами, отдельно не посчитан. Это функциональная выборка сайта: наличие других регистраций в исходном архиве не означает пропуск веб-сценария.

Справочник не является машинной OpenAPI-спецификацией. Перед изменением конкретного payload проверяйте указанную функцию, связанные модели и тесты; общие предположения о REST не заменяют действующий контракт.
