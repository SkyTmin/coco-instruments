import React from 'react';
import './QuickActions.css';

function QuickActions() {
  const categories = [
    { name: 'Финансовые сервисы', icon: '💰', count: '15+', description: 'Калькуляторы, анализ' },
    { name: 'Геодезические сервисы', icon: '🗺️', count: '12+', description: 'Карты, координаты' }
  ];

  return (
    <section className="quick-actions">
      <h2 className="section-title">Доступные сервисы</h2>
      <div className="categories-grid">
        {categories.map((category, index) => (
          <div key={index} className="category-card">
            <div className="category-icon">{category.icon}</div>
            <h3 className="category-name">{category.name}</h3>
            <p className="category-description">{category.description}</p>
            <span className="category-count">{category.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default QuickActions;
