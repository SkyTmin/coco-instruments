import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { signOut } from '../../utils/api';
import './Header.css';

function Header() {
  const { user } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <header className="header">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link to="/" className="logo">
          <h1 className="text-2xl font-bold text-white">Coco Instruments</h1>
        </Link>
        <nav className="nav-links">
          {user ? (
            <div className="user-menu">
              <span className="user-name">Привет, {user.user_metadata?.name || user.email}</span>
              <button onClick={handleSignOut} className="btn-secondary ml-4">
                Выйти
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="btn-secondary">
                Вход
              </Link>
              <Link to="/register" className="btn-primary ml-4">
                Регистрация
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export default Header;
