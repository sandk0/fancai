# Docker UI

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секция 8

---

## 1. Рекомендация: Dockge > Portainer

| Критерий          | Dockge                                  | Portainer CE                       |
| ----------------- | --------------------------------------- | ---------------------------------- |
| Compose файлы     | **На диске (git-trackable)**            | В внутренней БД                    |
| RAM               | ~15-25MB                                | ~30-50MB                           |
| Функциональность  | Compose management                      | Полное Docker управление           |
| Автор             | Louis Lam (Uptime Kuma)                 | Portainer.io                       |
| CLI совместимость | Использует `docker compose` под капотом | CLI-созданные ресурсы = "external" |
| Сложность         | Минимальная                             | Средняя                            |

## 2. Почему Dockge

1. **Compose файлы остаются на диске** — `docker-compose.lite.prod.yml` остаётся git-trackable
2. **Не конфликтует с CLI** — использует тот же `docker compose` под капотом
3. **Проверенный автор** — Louis Lam создал Uptime Kuma (83K GitHub stars)
4. **Проще** — делает ровно то что нужно для compose management

## 3. Дополнительно: Lazydocker

Установить Lazydocker на сервер как terminal UI для быстрой инспекции через SSH.

---

## Источники

- [Dockge GitHub](https://github.com/louislam/dockge)
- [Portainer vs Dockge Comparison](https://homelabsec.com/posts/portainer-vs-dockge/)
