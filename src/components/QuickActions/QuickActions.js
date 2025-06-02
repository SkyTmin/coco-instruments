import React from 'react';
import './QuickActions.css';

function QuickActions() {
  const categories = [
    { name: 'Финансовые калькуляторы', icon: '💰', count: '15+' },
    { name: 'Анализ инвестиций', icon: '📈', count: '12+' },
    { name: 'Геодезические расчеты', icon: '🗺️', count: '18+' },
    { name: 'Координатные системы', icon: '📍', count: '8+' },
    { name: 'Кредитные калькуляторы', icon: '🏦', count: '10+' },
    { name: 'Топографические карты', icon: '🧭', count: '6+' }
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