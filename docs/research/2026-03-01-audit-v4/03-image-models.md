# Image модели и стратегия

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секция 3

---

## 1. Доступные модели на OpenRouter

| Модель                         | Цена/изображение | Скорость | Качество      | Safety фильтры                  |
| ------------------------------ | ---------------- | -------- | ------------- | ------------------------------- |
| **FLUX.2 Pro**                 | $0.030           | 5-10s    | Excellent     | Moderate (лучше для литературы) |
| **FLUX.2 Klein**               | $0.014           | <1s      | Good          | Moderate                        |
| **FLUX.2 Max**                 | $0.070           | ~15s     | Best-in-class | Moderate                        |
| Seedream 4.5                   | $0.040           | 5-10s    | Very Good     | Moderate                        |
| Nano Banana (Gemini 2.5 Flash) | ~$0.039          | 20-40s   | Good          | Strict (настраиваемые)          |
| Nano Banana Pro (Gemini 3 Pro) | ~$0.10+          | 40-60s   | Excellent     | Strict                          |
| GPT-5 Image                    | ~$0.040          | 10-20s   | Very Good     | Strict                          |

Для сравнения: текущий Imagen 4 Fast = $0.02/изображение.

## 2. Fallback chain для изображений

```
Primary:      FLUX.2 Pro         ($0.03/img) — лучший баланс качество/цена, умеренные фильтры
Fallback 1:   FLUX.2 Klein       ($0.014/img) — при rate limit, бюджетный
Fallback 2:   Seedream 4.5       ($0.04/img) — другой провайдер (ByteDance)
Emergency:    Nano Banana         (~$0.04/img) — Google-backed, всегда доступен
```

## 3. Стратегия по тарифам (изображения)

| Тариф       | Модель                        | Цена/img   | Лимит/мес           |
| ----------- | ----------------------------- | ---------- | ------------------- |
| **Free**    | FLUX.2 Klein                  | $0.014     | 10 img ($0.14/user) |
| **Paid**    | FLUX.2 Pro                    | $0.030     | 100 img ($3/user)   |
| **Premium** | FLUX.2 Pro + Max (key scenes) | $0.03-0.07 | 300 img             |

## 4. Что теряем при уходе с Imagen 4

| Потеря                            | Критичность | Замена                               |
| --------------------------------- | ----------- | ------------------------------------ |
| `person_generation="allow_adult"` | HIGH        | FLUX.2 более permissive по умолчанию |
| `safety_filter_level`             | MEDIUM      | FLUX.2 — менее строгие фильтры       |
| `seed` для reproducibility        | LOW         | Модель-зависимо                      |
| Прямой Google SDK                 | LOW         | OpenRouter unified API               |

## 5. Что получаем

- 15+ моделей вместо 1 провайдера
- Менее строгие фильтры (FLUX.2) — лучше для классической литературы
- Ценовая гибкость ($0.014-0.15)
- Multi-provider resilience

---

## Источники

- [OpenRouter Image Models Collection](https://openrouter.ai/collections/image-models)
- [FLUX.2 Pro on OpenRouter](https://openrouter.ai/black-forest-labs/flux.2-pro)
- [FLUX.2 Pro Review vs Midjourney/Nano Banana](https://medium.com/@leucopsis/flux-2-pro-review-and-comparison-with-midjourney-v7-and-with-nano-banana-pro-337224a5551f)
