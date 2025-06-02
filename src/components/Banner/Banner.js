import React from 'react';
import './Banner.css';

function Banner() {
  return (
    <section className="banner">
      <div className="banner-content">
        <h1 className="banner-title">
          Финансовые и геодезические инструменты
        </h1>
        <p className="banner-description">
          Профессиональные калькуляторы для финансовых расчетов и геодезических вычислений. 
          Кредиты, инвестиции, координаты, расстояния - все в одном месте.
        </p>
      </div>
    </section>
  );
}

export default Banner;