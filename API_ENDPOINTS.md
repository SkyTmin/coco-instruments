# API Endpoints для синхронизации данных

Для работы системы синхронизации данных между устройствами необходимо создать следующие API endpoints на бэкенде:

## 1. Coco Money (Финансы)

### Доходные листы и предварительные доходы
```
GET    /api/v1/coco-money/sheets
POST   /api/v1/coco-money/sheets
```

**GET Response:**
```json
{
  "success": true,
  "data": {
    "income": [
      {
        "id": "1234567890",
        "name": "Зарплата за январь",
        "amount": 50000,
        "date": "2025-01-15",
        "note": "Основная зарплата",
        "expenses": [
          {
            "name": "Транспорт",
            "amount": 5000,
            "category": "transport",
            "note": "Проездной"
          }
        ]
      }
    ],
    "preliminary": []
  }
}
```

**POST Request:**
```json
{
  "sheets": {
    "income": [...],
    "preliminary": [...]
  }
}
```

### Категории расходов
```
GET    /api/v1/coco-money/categories
POST   /api/v1/coco-money/categories
```

**GET Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "custom-category-1",
      "name": "Медицина"
    }
  ]
}
```

**POST Request:**
```json
{
  "categories": [
    {
      "id": "custom-category-1",
      "name": "Медицина"
    }
  ]
}
```

## 2. Debts (Долги)

### Долги
```
GET    /api/v1/debts
POST   /api/v1/debts
```

**GET Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "debt-1",
      "name": "Кредит на машину",
      "amount": 500000,
      "date": "2025-01-01",
      "category": "personal",
      "status": "active",
      "note": "Автокредит в банке",
      "payments": [
        {
          "id": "payment-1",
          "amount": 50000,
          "date": "2025-01-15",
          "note": "Первый платеж",
          "preliminary": false
        }
      ]
    }
  ]
}
```

**POST Request:**
```json
{
  "debts": [...]
}
```

### Категории долгов
```
GET    /api/v1/debts/categories
POST   /api/v1/debts/categories
```

Структура аналогична категориям Coco Money.

## 3. Clothing Size (Размеры одежды)

```
GET    /api/v1/clothing-size
POST   /api/v1/clothing-size
```

**GET Response:**
```json
{
  "success": true,
  "data": {
    "parameters": {
      "height": 170,
      "weight": 70,
      "chest": 96,
      "waist": 80,
      "hips": 98,
      "neck": 38,
      "foot": 26,
      "inseam": 81,
      "wrist": 17,
      "head": 56
    },
    "savedResults": [
      {
        "category": "outerwear",
        "date": "2025-01-15T10:30:00Z",
        "parameters": {...}
      }
    ],
    "currentGender": "male"
  }
}
```

**POST Request:**
```json
{
  "parameters": {...},
  "savedResults": [...],
  "currentGender": "male"
}
```

## 4. Scale Calculator (Калькулятор масштабов)

### История расчетов
```
GET    /api/v1/scale-calculator/history
POST   /api/v1/scale-calculator/history
```

**GET Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1642234567890,
      "scale": 500,
      "textHeight": 1.25,
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

**POST Request:**
```json
{
  "history": [
    {
      "id": 1642234567890,
      "scale": 500,
      "textHeight": 1.25,
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

## Общие требования

### Аутентификация
Все endpoints требуют Bearer токена в заголовке:
```
Authorization: Bearer <access_token>
```

### Формат ответов
Все ответы должны иметь единообразный формат:

**Успешный ответ:**
```json
{
  "success": true,
  "data": {...}
}
```

**Ошибка:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Неверные данные",
    "details": {...}
  }
}
```

### HTTP коды состояния
- `200` - Успешное получение данных
- `201` - Успешное создание/обновление данных
- `400` - Ошибка валидации данных
- `401` - Ошибка авторизации
- `403` - Нет доступа к ресурсу
- `404` - Ресурс не найден
- `500` - Внутренняя ошибка сервера

### CORS
Настройте CORS для работы с фронтендом:
```
Access-Control-Allow-Origin: https://your-frontend-domain.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
```

## Безопасность

1. **Валидация данных**: Проверяйте все входящие данные на соответствие схеме
2. **Размер данных**: Ограничьте размер JSON payloads (например, 1MB)
3. **Rate limiting**: Ограничьте количество запросов от одного пользователя
4. **Изоляция данных**: Каждый пользователь должен видеть только свои данные

## Примеры реализации (Node.js/Express)

```javascript
// Coco Money sheets endpoint
app.get('/api/v1/coco-money/sheets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const sheets = await CocoMoneySheets.findOne({ userId });
    
    res.json({
      success: true,
      data: sheets?.data || { income: [], preliminary: [] }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ошибка получения данных'
      }
    });
  }
});

app.post('/api/v1/coco-money/sheets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { sheets } = req.body;
    
    // Валидация данных
    if (!sheets || typeof sheets !== 'object') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Неверный формат данных'
        }
      });
    }
    
    await CocoMoneySheets.findOneAndUpdate(
      { userId },
      { userId, data: sheets },
      { upsert: true }
    );
    
    res.json({
      success: true,
      data: { message: 'Данные сохранены' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ошибка сохранения данных'
      }
    });
  }
});
```

## База данных

Рекомендуемая структура коллекций/таблиц:

```javascript
// MongoDB схемы
const CocoMoneySheetsSchema = {
  userId: ObjectId,
  data: {
    income: Array,
    preliminary: Array
  },
  updatedAt: Date,
  createdAt: Date
};

const CocoMoneyCategoriesSchema = {
  userId: ObjectId,
  categories: Array,
  updatedAt: Date
};

const DebtsSchema = {
  userId: ObjectId,
  debts: Array,
  updatedAt: Date
};

const DebtCategoriesSchema = {
  userId: ObjectId,
  categories: Array,
  updatedAt: Date
};

const ClothingSizeSchema = {
  userId: ObjectId,
  data: {
    parameters: Object,
    savedResults: Array,
    currentGender: String
  },
  updatedAt: Date
};

const ScaleCalculatorSchema = {
  userId: ObjectId,
  history: Array,
  updatedAt: Date
};
```

## Тестирование

Используйте эти curl команды для тестирования endpoints:

```bash
# Получение данных Coco Money
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://your-api.com/api/v1/coco-money/sheets

# Сохранение данных Coco Money
curl -X POST \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"sheets":{"income":[],"preliminary":[]}}' \
     https://your-api.com/api/v1/coco-money/sheets
```
