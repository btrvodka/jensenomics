# Jensenomics

**RU** · Шуточный 3D-сайт: «вся мировая экономика» в виде treemap'а из 51 техкомпании с живыми котировками крутится на ~~пальце~~ Хуанга. Чем сильнее штормит рынок, тем быстрее крутится и сильнее шатается.

**EN** · A joke 3D website: "the entire world economy", a live-quote treemap of 51 tech stocks, spinning on Jensen Huang's… well, you'll see. The more volatile the market, the faster it spins and the harder it wobbles.

![screenshot](docs/screenshot-en.png)

<details><summary>Русская версия</summary>

![скриншот](docs/screenshot-ru.png)

</details>

## Запуск / Run

```sh
go build -o jensenomics . && ./jensenomics      # http://localhost:8080
./jensenomics -addr :3000 -refresh 30s           # другой порт и частота обновления / custom port & refresh
./jensenomics -demo                              # выдуманные котировки, без интернета / fake quotes, offline
```

Нужен Go 1.22+. Фронтенд встроен в бинарник через `embed`.
Requires Go 1.22+. The frontend is embedded into the binary.

### Make

```sh
make run            # собрать и запустить / build & run (PORT=8080 REFRESH=1m)
make demo           # демо-режим / demo mode
make help           # все команды / all targets
```

### Docker

```sh
make docker-build && make docker-run          # http://localhost:8080
# или напрямую / or directly:
docker build -t jensenomics .
docker run --rm -p 8080:8080 jensenomics
```

## Как это устроено / How it works

- `quotes.go` — каждые N секунд забирает цену и % изменения за день с Yahoo Finance (`v8/finance/chart`), отдаёт их на `/api/quotes`. / Polls Yahoo Finance and serves `/api/quotes`.
- `tickers.go` — список бумаг, групп и примерных капитализаций (капитализация только задаёт размер плиток). / Ticker list; market caps are rough and only set tile sizes.
- `web/app.js` — сцена на three.js: сердце строится из неявного уравнения поверхности, treemap рисуется на canvas и натягивается текстурой, подписи — 2D-оверлей. Переключатель RU/EN в панели. / three.js scene, canvas-drawn treemap texture, RU/EN switch.

## Дисклеймер / Disclaimer

Это пародия и мем, не инвестиционный совет. Проект никак не связан с NVIDIA или Дженсеном Хуангом. Данные Yahoo Finance неофициальные и с задержкой.

This is a parody and a meme, not investment advice. Not affiliated with NVIDIA or Jensen Huang. Yahoo Finance data is unofficial and delayed.
