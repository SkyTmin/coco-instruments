import React from 'react';
import Header from '../../components/Header/Header';
import Banner from '../../components/Banner/Banner';
import SearchBar from '../../components/SearchBar/SearchBar';
import QuickActions from '../../components/QuickActions/QuickActions';
import './Home.css';

function Home() {
  return (
    <div className="home">
      <Header />
      <main className="main-content">
        <Banner />
        <SearchBar />
        <QuickActions />
      </main>
    </div>
  );
}

export default Home;