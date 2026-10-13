import type { Translation } from '../types';
import type { dfloors as ru } from '../ru/dfloors';

export const dfloors: Translation<typeof ru> = {
  f1: {
    name: "Sıçan Yuvaları",
    lead: "Kampın altındaki yuvalar: sıçanlar, sıçan adamlar, tuzaklar ve kralın Taht Salonu.",
    area: {
      mouth: {
        name: "Maden Girişi",
        lead: "Asansörün yanında eski galeriler. Sıçanlar ve ilk tuzaklar — adımına dikkat.",
      },
      haul: {
        name: "Kemirilmiş Galeriler",
        lead: "Sıçan adamların yuvaları: yollarda kapanlar, arkada şamanlar, kralın ini.",
      },
    },
    boss: {
      name: "Sıçan Kral",
      lead: "Kemirilmiş Galeriler'deki Taht Salonu",
    },
    mine: {
      pyrite1: "Giriş Madeni",
      pyrite2: "Derin Maden",
    },
  },
  f2: {
    name: "Mantar Mağarası",
    lead: "Her şeyin büyüyüp birbirini yediği mağara. Yukarıda — harabeler ve Canlı Zırh.",
    area: {
      f2grot: {
        name: "Mantar Mağarası",
        lead: "Mantarlar yürür, tavandan balçık damlar, kökler çığlık atar.",
      },
      f2ruin: {
        name: "Sarmaşıklı Harabeler",
        lead: "Mantar ağının yiyip bitirdiği kale. Askıdaki zırhlar — boş mu?",
      },
    },
    boss: {
      name: "Canlı Zırh",
      lead: "Sarmaşıklı Harabeler'in Taht Salonu",
    },
    mine: {
      f2mine1: "Kireçtaşı Galerisi",
      f2mine2: "Granit Ocağı",
    },
  },
  f3: {
    name: "Su Basmış Uçurum",
    lead: "Su ve kristallerle dolu dimdik bir uçurum. Karanlıktaki sesler yalan söyler, yükle tırmanmak seni geri çeker.",
    area: {
      f3rim: {
        name: "Uçurumun Kenarı",
        lead: "Turkuaz Mağara ve Büyük Uçurum. Yükle yukarı çıkmak zor.",
      },
      f3depth: {
        name: "Su Basmış Çıkıntılar",
        lead: "Şelaleler, Yankı Salonu ve Kızıl Göl. Çağrıya gitme.",
      },
    },
    boss: {
      name: "Kızıl Çene",
      lead: "Su Basmış Çıkıntılar'ın dibindeki Kızıl Göl",
    },
    mine: {
      f3mine1: "Kömür Galerisi",
      f3mine2: "Bakır Ocağı",
    },
  },
  f4: {
    name: "İkiz Mahzen",
    lead: "Sıradan bir mezar odası… ardında ikinci, asıl salon. Tahtta Taş Heykel; yontular ise onlara bakılmamasından hiç hoşlanmaz.",
    area: {
      f4crypt: {
        name: "Mahzen",
        lead: "Mezar odaları ve kemikli nişler. Burada kemikler, işlerini bitirmezsen yeniden kalkar.",
      },
      f4sanct: {
        name: "Gizli Salon",
        lead: "İkinci salon. Yontular bakıyor. Onlara uzun süre sırtını dönme.",
      },
    },
    boss: {
      name: "Taş Heykel",
      lead: "Gizli Salon'un sonundaki taht",
    },
    mine: {
      f4mine: "Demir Galerisi",
      f4mine2: "Kobalt Damarı",
    },
  },
  f5: {
    name: "Labirent",
    lead: "Canlı duvarlar, çıkmazlar ve döngüler. Duvarlardan canavarlar çıkar, derinlerde bir boğa böğürür.",
    area: {
      f5maze: {
        name: "Canlı Labirent",
        lead: "Duvarlar nefes alıyor. İşaretleri takip et.",
      },
      f5arena: {
        name: "Kolezyum",
        lead: "Labirentin kalbinde eski bir arena. Böğürtü duyuluyor.",
      },
    },
    boss: {
      name: "Minotor",
      lead: "Kolezyum'un kalbindeki arena",
    },
    mine: {
      f5mine1: "Labirent Madeni",
      f5mine2: "Kolezyum Madeni",
    },
  },
  f6: {
    name: "Ateş Yarığı",
    lead: "Lav, kül ve obsidyen. Aşağıda kızıl yılan uyuyor — ve aç.",
    area: {
      f6: {
        name: "Kül Galerileri",
        lead: "Asansörün yanında terk edilmiş bir kamp. Kazan hâlâ ılık.",
      },
      f6lakes: {
        name: "Lav Gölleri",
        lead: "Sıvı ateşin üstünde obsidyen köprüler. Durma.",
      },
      f6nest: {
        name: "Yılan Yuvası",
        lead: "Sıcaklık yerin altından geliyor. Yumurtalarını burada bırakır.",
      },
    },
    boss: {
      name: "Kızıl Yılan",
      lead: "Yuva'nın kalbindeki arena",
    },
    mine: {
      f6mine: "Kuvars Damarı",
      f6mine2: "Gümüş Galerisi",
    },
  },
  f7: {
    name: "Ayna Labirenti",
    lead: "Aynalar her adımı tekrarlar. Her geçit geçit değildir. Derinde seni kendin bekliyorsun.",
    area: {
      f7: {
        name: "Yansımalar Galerisi",
        lead: "Terk edilmiş bir ayna sarayı. Aynalardan bir şeyler çıkıyor.",
      },
      f7crystal: {
        name: "Kristal Labirent",
        lead: "Kristal duvarlar. Bir geçit, yansıma çıkabilir.",
      },
      f7hall: {
        name: "İkizin Salonu",
        lead: "Her aynada sen varsın. Yansımalardan biri bekliyor.",
      },
    },
    boss: {
      name: "Kahramanın Yansıması",
      lead: "İkizin Salonu'ndaki ayna arenası",
    },
    mine: {
      f7mine1: "Camcı Madeni",
      f7mine2: "Kristal Madeni",
    },
  },
  f8: {
    name: "Sonsuz Kale",
    lead: "Tatamiler, şojiler ve katlar arasında uçurum. Odalar biva tınısıyla kayar.",
    area: {
      f8: {
        name: "Alt Odalar",
        lead: "Kapılar kendiliğinden kayar. Kâğıdın ardından biri bakıyor.",
      },
      f8halls: {
        name: "Kayan Salonlar",
        lead: "Bir tel çınlar — ve duvarlar kayar. Çalanı bul.",
      },
      f8moon: {
        name: "Ay Salonu",
        lead: "Uçurumun üstünde köprüler. Yukarıda bir yerde yedi ay.",
      },
    },
    boss: {
      name: "Yedi Ay İblisi",
      lead: "Ay penceresinin altındaki arena",
    },
    mine: {
      f8mine: "Kiler Altı Madeni",
      f8mine2: "Ada Madeni",
    },
  },
  f9: {
    name: "Hidra Labirenti",
    lead: "Batık harabeler ve seni eşine taşıyan halkalar. Kara gölde, başları yeniden çıkan bir hidra.",
    area: {
      f9: {
        name: "Batık Harabeler",
        lead: "Bataklık şehri yuttu. Yerdeki halkalar seni taşır.",
      },
      f9maze: {
        name: "Halkalar Labirenti",
        lead: "Yerde olmayan yollar. Halkanın rengine bak.",
      },
      f9lair: {
        name: "Hidra İni",
        lead: "Kara bir göl. Su arkandan yükseliyor.",
      },
    },
    boss: {
      name: "Çok Başlı Hidra",
      lead: "İnin kalbindeki göl",
    },
    mine: {
      f9mine: "Harabe Madeni",
      f9mine2: "Halka Madeni",
    },
  },
  f10: {
    name: "İblis Tahtı",
    lead: "Kampın altında bir kale: Kapılar, vitraylar ve taht. Bütün inişler burada biter.",
    area: {
      f10: {
        name: "Yeraltı Kapıları",
        lead: "Kapılarda kahraman kemikleri. Ötesinde — uçurumun üstünde bir köprü.",
      },
      f10gallery: {
        name: "Vitray Galerisi",
        lead: "Camların ardında şimşekler. Yontular seni gözleriyle izliyor.",
      },
      f10throne: {
        name: "Taht Salonu",
        lead: "Tören Yolu. Sonunda — taht ve üstünde oturan.",
      },
    },
    boss: {
      name: "İblis Kral",
      lead: "Tören Yolu'nun sonundaki Taht Salonu",
    },
    mine: {
      f10mine: "İnfaz Avlusu Madeni",
      f10mine2: "Taht Altı Madeni",
    },
  },
  f11: {
    name: "Gök Takımadaları",
    lead: "Bulutlarda adalar. Burada rüzgâr efendi: kurdelelerin nereye uçtuğuna bak.",
    area: {
      f11: {
        name: "Rüzgâr Bahçeleri",
        lead: "Bulutların üstünde bir bahçe. Rüzgâr iter — kurdelelere karşı yürü.",
      },
      f11aqua: {
        name: "Yıkık Su Kemeri",
        lead: "Su göğe akıyor. Rüzgâr daha sert — ortada kal.",
      },
      f11castle: {
        name: "Bulut Kalesi",
        lead: "Kulelerin üstünde fırtına. Muhafızlar, avlularına adım atana dek uyur.",
      },
    },
    boss: {
      name: "Kadim Muhafız",
      lead: "Takımadaların tepesindeki \"Kalenin Kalbi\"",
    },
    mine: {
      f11mine: "Bahçe Madeni",
      f11mine2: "Kalp Altı Madeni",
    },
  },
  f12: {
    name: "Kutup Gecesi",
    lead: "Yeraltındaki kuzey: buz, kar ve sonsuz gece. Kubbeden kutup ışıkları süzülür.",
    area: {
      f12: {
        name: "Buz Mağarası",
        lead: "Mavi buz mağaraları. Kaygan; sıcaklık yalnızca mangalların yanında.",
      },
      f12plat: {
        name: "Donmuş Göl",
        lead: "Karanlığa dek uzanan dümdüz buz. İnce buz çatırdar, deliklerde foklar.",
      },
      f12shrine: {
        name: "Tipi Sarayı",
        lead: "Kutup ışıkları altında bir buz sarayı. Burada çatı altında bile tipi var.",
      },
    },
    boss: {
      name: "Buzul Mamutu",
      lead: "Kutup ışıkları altındaki saray, desenli buz",
    },
    mine: {
      f12mine: "Buz Ocağı",
      f12mine2: "Göl Altı Madeni",
    },
  },
  f13: {
    name: "Kukla Tiyatrosu",
    lead: "Terk edilmiş bir kukla tiyatrosu. Oyun kendi kendine sürüyor: kuklalar oyuncusuz oynuyor, ipler sahne üstünün karanlığına uzanıyor.",
    area: {
      f13: {
        name: "Fuaye",
        lead: "Avizeler kendiliğinden yanıyor. Kuklalar üçüncü zili bekliyor.",
      },
      f13wall: {
        name: "Seyirci Salonu",
        lead: "Karanlık bir salon. Spot ışığı neredeyse, seni orada görürler.",
      },
      f13bell: {
        name: "Sahne Üstü",
        lead: "Sahnenin üstünde köprüler, halatlar ve karşı ağırlıklar. İpler buradan çekilir.",
      },
    },
    boss: {
      name: "Kuklacı",
      lead: "Sahne üstünün altındaki büyük sahne",
    },
    mine: {
      f13mine: "Salon Altı Madeni",
      f13mine2: "Sahne Altı Madeni",
    },
  },
  f14: {
    name: "Saat Kulesi",
    lead: "Kule saatinin mekanizması. Dakikada bir çan çalar — ve dünya donar.",
    area: {
      f14: {
        name: "Mekanizma",
        lead: "Dişliler, sarkaçlar ve ağırlıklar. Burada her şey tempoyla hareket eder.",
      },
      f14sand: {
        name: "Kum Saati",
        lead: "Haznenin içinde. Burada kum yukarı akar.",
      },
      f14dial: {
        name: "Kadran",
        lead: "Camın ardında gece. Saatin kolları yerde dönüyor.",
      },
    },
    boss: {
      name: "Saatin Efendisi",
      lead: "Kulenin tepesindeki kadran arenası",
    },
    mine: {
      f14mine: "Ağırlık Altı Madeni",
      f14mine2: "Kum Madeni",
    },
  },
  f15: {
    name: "Zindanın Çekirdeği",
    lead: "Dipte düşmüş bir yıldız yatıyor. Zindan onun çevresinde büyüdü — ve ona uzanıyor.",
    area: {
      f15: {
        name: "Kristal Kökler",
        lead: "Kaya burada kristale dönüşür. Yıldız kırıkları her şeyi kendine çeker — seni de.",
      },
      f15gut: {
        name: "Kurucuların Gözlemevi",
        lead: "Zindanın kurucuları yıldızı buradan izlerdi. Kubbeler, halkalar, yerde gök haritaları.",
      },
      f15veins: {
        name: "Yörünge Kuşağı",
        lead: "Çekirdeğin çevresinde boşluk. Enkaz döner durur, içinde neredeyse hiçbir şeyin ağırlığı yok.",
      },
      f15heart: {
        name: "Çekirdek",
        lead: "Düşmüş yıldız burada yatıyor. Işığı yukarıda hüküm süren herkesi hatırlıyor.",
      },
    },
    boss: {
      name: "Zindanın Efendisi",
      lead: "Hafıza Salonu'nun ardındaki düşmüş yıldız arenası",
    },
    mine: {
      f15mine: "Kristal Damarı",
      f15mine2: "Kubbe Altı Madeni",
      f15mine3: "Göktaşı Parçası",
    },
  },
};
