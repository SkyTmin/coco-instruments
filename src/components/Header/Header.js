import React from 'react';
import { Link } from 'react-router-dom';
import './Header.css';

function Header() {
  return (
    <header className="header">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link to="/" className="logo">
          <h1 className="text-2xl font-bold text-white">Coco Instruments</h1>
        </Link>
        <nav className="nav-links">
          <Link to="/login" className="btn-secondary">
            Вход
          </Link>
          <Link to="/register" className="btn-primary ml-4">
            Регистрация
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default Header;