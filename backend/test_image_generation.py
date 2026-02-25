#!/usr/bin/env python3
"""
Тестирование генерации изображений для описаний.
"""

import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import AsyncSessionLocal
from app.models.description import Description, DescriptionType
from app.models.image import GeneratedImage
from app.models.user import User
from app.services.image_generator import image_generator_service
from sqlalchemy import select

async def test_image_generation():
    """Тестирует генерацию изображения для одного описания."""
    
    async with AsyncSessionLocal() as db:
        # Получаем первого пользователя
        user_result = await db.execute(select(User).limit(1))
        user = user_result.scalar_one_or_none()
        if not user:
            print("❌ Пользователь не найден")
            return
        
        # Получаем первое описание типа LOCATION
        result = await db.execute(
            select(Description)
            .where(Description.type == DescriptionType.LOCATION)
            .where(Description.is_suitable_for_generation == True)
            .order_by(Description.priority_score.desc())
            .limit(1)
        )
        
        description = result.scalar_one_or_none()
        if not description:
            print("❌ Описание для генерации не найдено")
            return
        
        print(f"🎨 Генерируем изображение для описания:")
        print(f"   Тип: {description.type.value}")
        print(f"   Текст: {description.content[:100]}...")
        print(f"   Приоритет: {description.priority_score}")
        
        # Проверяем, не сгенерировано ли уже изображение
        existing_image = await db.execute(
            select(GeneratedImage).where(GeneratedImage.description_id == description.id)
        )
        if existing_image.scalar_one_or_none():
            print("🔄 Изображение уже существует, пропускаем...")
            return
        
        try:
            # Генерируем изображение
            print("🔄 Запуск генерации...")
            result = await image_generator_service.generate_image_for_description(
                description=description,
                user_id=str(user.id)
            )
            
            if result.success:
                print(f"✅ Изображение сгенерировано!")
                print(f"   URL: {result.image_url}")
                print(f"   Время: {result.generation_time_seconds:.1f}с")
                print(f"   Локальный путь: {result.local_path}")
                
                # Сохраняем в базе данных
                generated_image = GeneratedImage(
                    description_id=description.id,
                    user_id=user.id,
                    service_used="pollinations.ai",
                    image_url=result.image_url,
                    local_path=result.local_path,
                    prompt_used="test generation",
                    generation_time_seconds=result.generation_time_seconds
                )
                
                db.add(generated_image)
                await db.commit()
                print("💾 Сохранено в базе данных")
                
            else:
                print(f"❌ Генерация не удалась: {result.error_message}")
                
        except Exception as e:
            print(f"❌ Ошибка генерации: {str(e)}")

if __name__ == "__main__":
    print("=" * 60)
    print("ТЕСТИРОВАНИЕ ГЕНЕРАЦИИ ИЗОБРАЖЕНИЙ")
    print("=" * 60)
    
    asyncio.run(test_image_generation())