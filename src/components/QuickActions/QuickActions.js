import React from 'react';
import './QuickActions.css';

function QuickActions() {
  const categories = [
    { name: 'Электроинструменты', icon: '⚡', count: '250+' },
    { name: 'Ручной инструмент', icon: '🔧', count: '180+' },
    { name: 'Измерительные', icon: '📏', count: '120+' },
    { name: 'Садовый инструмент', icon: '🌱', count: '90+' },
    { name: 'Автоинструменты', icon: '🚗', count: '160+' },
    { name: 'Строительные', icon: '🏗️', count: '200+' }
  ];

  return (
    <section className="quick-actions">
      <h2 className="section-title">Популярные категории</h2>
      <div className="categories-grid">
        {categories.map((category, index) => (
          <div key={index} className="category-card">
            <div className="category-icon">{category.icon}</div>
            <h3 className="category-name">{category.name}</h3>
            <span className="category-count">{category.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default QuickActions;