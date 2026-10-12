import type { Translation } from '../types';
import type { pets as ru } from '../ru/pets';

export const pets: Translation<typeof ru> = {
  mole: {
    name: 'Madenci Köstebek',
    lore: 'Ocağa ilk o girer, en son o çıkar',
  },
  roach: {
    name: 'Yarışçı Hamamböceği',
    lore: 'Hamamböceği yarışlarının şampiyonu, yedi numara',
  },
  mouse: {
    name: 'Yankesici Fare',
    lore: 'Ortada ne varsa onundur',
  },
  pigeon: {
    name: 'Postacı Güvercin',
    lore: 'Dışarıdan haber getirir, bazen iyi',
  },
  cat: {
    name: 'Yaralı Kedi',
    lore: 'Son balık kılçığına kadar pazarlık eder',
  },
  bulldog: {
    name: 'Muşta Buldok',
    lore: 'Kayayı alnıyla deler',
  },
  ferret: {
    name: 'Ayakçı Gelincik',
    lore: 'Bir saniye yerinde durmaz',
  },
  scarab: {
    name: 'Skarabe Böceği',
    lore: 'Parlayan her şeyi top yapıp yuvarlar',
  },
  badger: {
    name: 'Tünelci Porsuk',
    lore: 'Tüneli cetvel gibi dümdüz kazar',
  },
  owl: {
    name: 'Fenerci Baykuş',
    lore: 'Saklı olanın üstüne ışık tutar',
  },
  raccoon: {
    name: 'Kasacı Rakun',
    lore: 'Cevheri kasa gibi açar',
  },
  shepherd: {
    name: 'Sadık Çoban Köpeği',
    lore: 'Eskiden konvoy bekçisiydi, artık bizden',
  },
  fox: {
    name: 'Kumarbaz Tilki',
    lore: 'Kulağının arkasında hep bir as',
  },
  spider: {
    name: 'Maymuncuk Örümcek',
    lore: 'Sekiz bacak, sekiz maymuncuk',
  },
  dragon: {
    name: 'Kömür Ejderhası',
    lore: 'Taşı eritip altına çevirir',
  },
  wolf: {
    name: 'Elebaşı Kurt',
    lore: 'Zinciri kırdı, sürüyü topladı',
  },
  raven: {
    name: 'Anahtarcı Kuzgun',
    lore: 'Kamptaki her kapının anahtarı onda',
  },
  phoenix: {
    name: 'Özgürlük Ankası',
    lore: 'Yanar ve doğar, her seferinde daha özgür',
  },
};
