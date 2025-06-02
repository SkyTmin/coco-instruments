-- Создание базы данных coco_instruments
CREATE DATABASE coco_instruments;

-- Использование базы данных
\c coco_instruments;

-- Включение расширений
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Таблица пользователей
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица категорий инструментов
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    parent_id UUID REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица инструментов
CREATE TABLE tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    category_id UUID REFERENCES categories(id),
    type VARCHAR(100) NOT NULL, -- 'finance', 'geodesy'
    config JSONB, -- Конфигурация инструмента
    is_active BOOLEAN DEFAULT true,
    views_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица расчетов пользователей
CREATE TABLE calculations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    tool_id UUID REFERENCES tools(id),
    input_data JSONB NOT NULL,
    result_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица избранных инструментов
CREATE TABLE user_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    tool_id UUID REFERENCES tools(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tool_id)
);

-- Таблица логов использования
CREATE TABLE usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    tool_id UUID REFERENCES tools(id),
    action VARCHAR(100), -- 'view', 'calculate', 'favorite'
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для оптимизации
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_tools_category ON tools(category_id);
CREATE INDEX idx_tools_type ON tools(type);
CREATE INDEX idx_tools_slug ON tools(slug);
CREATE INDEX idx_calculations_user ON calculations(user_id);
CREATE INDEX idx_calculations_tool ON calculations(tool_id);
CREATE INDEX idx_calculations_created ON calculations(created_at);
CREATE INDEX idx_usage_logs_user ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_tool ON usage_logs(tool_id);
CREATE INDEX idx_usage_logs_created ON usage_logs(created_at);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tools_updated_at BEFORE UPDATE ON tools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Базовые категории
INSERT INTO categories (name, slug, description, icon, sort_order) VALUES
('Финансовые инструменты', 'finance', 'Калькуляторы и инструменты для финансовых расчетов', '💰', 1),
('Геодезические инструменты', 'geodesy', 'Инструменты для геодезических расчетов и картографии', '🗺️', 2);

-- Подкategории для финансов
INSERT INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES
('Кредитные калькуляторы', 'credit-calculators', 'Расчет кредитов и займов', '🏦', 
    (SELECT id FROM categories WHERE slug = 'finance'), 1),
('Инвестиционные калькуляторы', 'investment-calculators', 'Анализ инвестиций и доходности', '📈', 
    (SELECT id FROM categories WHERE slug = 'finance'), 2),
('Налоговые калькуляторы', 'tax-calculators', 'Расчет налогов и льгот', '📊', 
    (SELECT id FROM categories WHERE slug = 'finance'), 3);

-- Подкategории для геодезии
INSERT INTO categories (name, slug, description, icon, parent_id, sort_order) VALUES
('Координатные системы', 'coordinates', 'Конвертация координат между системами', '📍', 
    (SELECT id FROM categories WHERE slug = 'geodesy'), 1),
('Расчет расстояний', 'distances', 'Расчет расстояний и площадей', '📏', 
    (SELECT id FROM categories WHERE slug = 'geodesy'), 2),
('Топографические расчеты', 'topography', 'Высотные отметки и рельеф', '🧭', 
    (SELECT id FROM categories WHERE slug = 'geodesy'), 3);

-- Базовые финансовые инструменты
INSERT INTO tools (name, slug, description, category_id, type, config) VALUES
('Кредитный калькулятор', 'loan-calculator', 'Расчет ежемесячных платежей по кредиту',
    (SELECT id FROM categories WHERE slug = 'credit-calculators'), 'finance',
    '{"fields": ["amount", "rate", "term"], "formula": "pmt"}'),
    
('Ипотечный калькулятор', 'mortgage-calculator', 'Расчет ипотечных платежей',
    (SELECT id FROM categories WHERE slug = 'credit-calculators'), 'finance',
    '{"fields": ["amount", "rate", "term", "downPayment"], "formula": "mortgage"}'),
    
('Калькулятор сложных процентов', 'compound-interest', 'Расчет сложных процентов',
    (SELECT id FROM categories WHERE slug = 'investment-calculators'), 'finance',
    '{"fields": ["principal", "rate", "time", "frequency"], "formula": "compound"}');

-- Базовые геодезические инструменты  
INSERT INTO tools (name, slug, description, category_id, type, config) VALUES
('Конвертер координат', 'coordinate-converter', 'Преобразование между системами координат',
    (SELECT id FROM categories WHERE slug = 'coordinates'), 'geodesy',
    '{"inputSystems": ["WGS84", "UTM", "MSK64"], "outputSystems": ["WGS84", "UTM", "MSK64"]}'),
    
('Расчет расстояния', 'distance-calculator', 'Расчет расстояния между двумя точками',
    (SELECT id FROM categories WHERE slug = 'distances'), 'geodesy',
    '{"methods": ["haversine", "vincenty"], "units": ["km", "m", "miles"]}'),
    
('Калькулятор площади', 'area-calculator', 'Расчет площади полигона по координатам',
    (SELECT id FROM categories WHERE slug = 'distances'), 'geodesy',
    '{"methods": ["shoelace"], "units": ["sq_m", "sq_km", "hectare"]}');