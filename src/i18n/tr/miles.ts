import type { Translation } from '../types';
import type { miles as ru } from '../ru/miles';

export const miles: Translation<typeof ru> = {
  b1k: { title: 'Bin blok', text: 'Kendi ellerinle kır' },
  b10k: { title: 'On bin', text: 'Kendi ellerinle kır' },
  b100k: { title: 'Yüz bin', text: 'Kendi ellerinle kır' },
  b1m: { title: 'Bir milyon', text: 'Kendi ellerinle kır' },
  z: { title: 'İlk Z', text: 'Son rütbeye ulaş' },
  p1: { title: 'Prestij 1', text: 'İkinci cezana başla' },
  p5: { title: 'Prestij 5', text: 'Beşinci ceza' },
  p10: { title: 'Prestij 10', text: 'Dördüncü rün yuvası' },
  p20: { title: 'Prestij 20', text: 'Yirmi ceza' },
  legend: { title: 'Ocak efsanesi', text: 'Seriyi “Ocak efsanesi”ne çıkar' },
  pets6: { title: 'Altı tür', text: 'Yumurtadan altı farklı hayvan çıkar' },
  hatch50: { title: 'Kuluçka tavuğu', text: 'Elli yumurta kuluçkala' },
  golden: { title: 'Altın hayvan', text: 'Aynısından beş tane topla' },
  zoo: { title: 'Bütün hayvanat bahçesi', text: '18’inin hepsini topla' },
  cases: { title: 'Yüz sandık', text: 'Anahtarla aç' },
  seid: { title: 'Seyit bekçisi', text: 'On seyit taşı kır' },
  bats: { title: 'Yarasa avcısı', text: 'Otuz yarasa yakala' },
  parcels: { title: 'Yüz koli', text: 'Hepsini aç' },
};
