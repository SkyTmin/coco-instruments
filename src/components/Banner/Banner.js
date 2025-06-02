import React from 'react';
import './Banner.css';

function Banner() {
  return (
    <section className="banner">
      <div className="banner-content">
        <h1 className="banner-title">
          Найдите нужные инструменты
        </h1>
        <p className="banner-description">
          Каталог профессиональных инструментов для любых задач. 
          Быстрый поиск, детальные характеристики, лучшие цены.
        </p>
      </div>
    </section>
  );
}

export default Banner;