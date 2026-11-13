# Jensenomics

**RU** · Шуточный 3D-сайт по мотивам мема: «вся мировая экономика» в виде treemap'а из 51 техкомпании с живыми котировками крутится на палке Хуанга. Чем сильнее штормит рынок, тем быстрее крутится и сильнее шатается. А ещё её можно уронить.

**EN** · A joke 3D website based on a meme: "the entire world economy", a live-quote treemap of 51 tech stocks, spinning on Jensen Huang's stick. The more volatile the market, the faster it spins and the harder it wobbles. You can also knock it over.

![screenshot](docs/screenshot-ru.png)

<details><summary>English version</summary>

![screenshot](docs/screenshot-en.png)

</details>

## Пасхалки / Easter eggs

| | RU | EN |
|---|---|---|
| Постамент | Тащи мышкой или пальцем: мир шатается, но держит баланс. Резкий рывок роняет его. | Drag the pedestal: the world wobbles but keeps balance. Yank it and it falls. |
| Палка | Тыкай в неё: каждый тычок раскачивает. Пара тычков в такт — и всё рушится. | Poke the stick: each poke rocks it. A couple in rhythm and it all comes down. |
| Крен рынка | Пока мир кренится, рядом показан «Крен рынка −N%». | While tilting, a "Market tilt −N%" gauge shows how close it is to falling. |
| Крах | «КРАХ! Вся мировая экономика −xx%», а потом Хуанг везёт новые видеокарты и всё чинит. | "CRASH! The entire world economy −xx%", then Jensen ships more GPUs and fixes it. |
| Мир | Зажми, чтобы остановить, или раскрути рукой. | Hold it to stop the spin, or spin it by hand. |

Есть идея пасхалки? Кнопка «Предложить идею» на сайте ведёт в [issues](https://github.com/btrvodka/jensenomics/issues/new). / Got an idea? The "Suggest an idea" button opens an [issue](https://github.com/btrvodka/jensenomics/issues/new).

<p>
  <img src="docs/crash-ru.png" width="68%" alt="крах">
  <img src="docs/mobile-ru.png" width="22%" alt="мобильная версия">
</p>

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

Готовый образ / Prebuilt image (linux/amd64, linux/arm64):

```sh
docker run --rm -p 8080:8080 ghcr.io/btrvodka/jensenomics
```

Собрать самому / Build yourself:

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
- Физика пасхалок — перевёрнутый маятник с «балансировщиком»: пружина держит палку, рывки постамента и тычки её раскачивают; после порога крена мир слетает и падает с отскоками на постамент и пол. / Easter-egg physics: a self-balancing inverted pendulum; past the tilt threshold the world flies off and bounces off the pedestal and floor.
- Скорость вращения зависит от средней волатильности, покачивание — от падения рынка. / Spin speed follows average volatility, wobble follows market drop.

## Дисклеймер / Disclaimer

Это пародия и мем, не инвестиционный совет. Проект никак не связан с NVIDIA или Дженсеном Хуангом. Данные Yahoo Finance неофициальные и с задержкой.

This is a parody and a meme, not investment advice. Not affiliated with NVIDIA or Jensen Huang. Yahoo Finance data is unofficial and delayed.

## Публикация образа / Publishing the image

- **CI:** пуш тега `v1.2.3` → GitHub Actions публикует `ghcr.io/btrvodka/jensenomics:1.2.3`, `:1.2` и `:latest`. / Pushing a `v*` tag publishes the image via GitHub Actions.
- **Вручную / Manually:** `cp .env.example .env`, вписать `GHCR_TOKEN` (scope `write:packages`), затем `make docker-login && make docker-push`.
