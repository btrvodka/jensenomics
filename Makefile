APP     := jensenomics
IMAGE   ?= $(APP)
TAG     ?= latest
PORT    ?= 8080
REFRESH ?= 1m

.PHONY: help build run demo fmt vet check clean docker-build docker-run docker-demo docker-stop

help: ## показать команды
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-14s\033[0m %s\n", $$1, $$2}'

build: ## собрать бинарник
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $(APP) .

run: build ## запустить с живыми котировками
	./$(APP) -addr :$(PORT) -refresh $(REFRESH)

demo: build ## запустить с выдуманными котировками (без интернета)
	./$(APP) -addr :$(PORT) -demo -refresh 5s

fmt: ## отформатировать код
	gofmt -w .

vet: ## go vet
	go vet ./...

check: vet ## проверить форматирование и vet
	@test -z "$$(gofmt -l .)" || (echo "не отформатировано:"; gofmt -l .; exit 1)

clean: ## удалить бинарник
	rm -f $(APP)

docker-build: ## собрать Docker-образ
	docker build -t $(IMAGE):$(TAG) .

docker-run: ## запустить образ на порту PORT
	docker run --rm -d --name $(APP) -p $(PORT):8080 $(IMAGE):$(TAG) -addr :8080 -refresh $(REFRESH)
	@echo "http://localhost:$(PORT)"

docker-demo: ## запустить образ в демо-режиме
	docker run --rm -d --name $(APP) -p $(PORT):8080 $(IMAGE):$(TAG) -addr :8080 -demo -refresh 5s
	@echo "http://localhost:$(PORT)"

docker-stop: ## остановить контейнер
	docker stop $(APP)
