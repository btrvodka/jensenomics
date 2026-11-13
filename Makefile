# Локальные настройки (GHCR_TOKEN, ...) из .env, см. .env.example. Экспортируются только объявленные там переменные.
ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

APP     := jensenomics
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
PORT    ?= 8080
REFRESH ?= 1m

# GitHub Container Registry. Создай personal access token со scope write:packages,
# положи его в .env (GHCR_TOKEN, см. .env.example) и залогинься один раз:
#   make docker-login
# затем опубликуй текущий коммит (тег вида v1.2.0 даёт чистую версию):
#   make docker-push                       # ghcr.io/btrvodka/jensenomics:<версия без v> и :latest
#   make docker-push VERSION=v1.2.0 LATEST=false
IMAGE     ?= ghcr.io/btrvodka/jensenomics
GHCR_USER ?= btrvodka
PLATFORMS ?= linux/amd64,linux/arm64
LATEST    ?= true
# Теги образа без префикса «v», как у публикуемых CI: v1.2.0 -> 1.2.0.
IMAGE_TAG := $(patsubst v%,%,$(VERSION))

.PHONY: help build run demo fmt vet check clean docker-build docker-run docker-demo docker-stop docker-login docker-push

help: ## показать команды
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-14s\033[0m %s\n", $$1, $$2}'

build: ## собрать бинарник
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(APP) .

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

docker-build: ## собрать Docker-образ локально
	docker build --build-arg VERSION=$(VERSION) -t $(IMAGE):$(IMAGE_TAG) -t $(IMAGE):latest .

docker-run: ## запустить образ на порту PORT
	docker run --rm -d --name $(APP) -p $(PORT):8080 -v $(APP)-data:/data $(IMAGE):latest -addr :8080 -refresh $(REFRESH) -crash-file /data/crashes
	@echo "http://localhost:$(PORT)"

docker-demo: ## запустить образ в демо-режиме
	docker run --rm -d --name $(APP) -p $(PORT):8080 $(IMAGE):latest -addr :8080 -demo -refresh 5s
	@echo "http://localhost:$(PORT)"

docker-stop: ## остановить контейнер
	docker stop $(APP)

docker-login: ## залогиниться в ghcr.io токеном из .env
	@test -n "$$GHCR_TOKEN" || { echo "GHCR_TOKEN не задан: положи его в .env (см. .env.example)"; exit 1; }
	@echo "$$GHCR_TOKEN" | docker login ghcr.io -u $(GHCR_USER) --password-stdin

docker-push: ## собрать multi-arch образ и опубликовать в ghcr.io
	@case "$(VERSION)" in *dirty*) echo "не публикую $(VERSION): закоммить изменения или задай VERSION"; exit 1;; esac
	docker buildx build --platform $(PLATFORMS) --build-arg VERSION=$(VERSION) \
		-t $(IMAGE):$(IMAGE_TAG) $(if $(filter true,$(LATEST)),-t $(IMAGE):latest) --push .
