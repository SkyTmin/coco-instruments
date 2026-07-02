// ---------------------------------------------------------------------------
// «Обучение по расчётному листку»: пользователь загружает PDF расчётного
// листка, мы вытаскиваем текст (pdfjs, лениво) и распознаём параметры оплаты —
// часовую ставку, районный коэффициент, северную, премию, вахтовую, НДФЛ.
// Распознанное подставляется в конструктор зарплаты как черновик: пользователь
// видит, что нашлось, и подтверждает. Работает только с текстовыми PDF
// (сканы без текстового слоя распознать не сможем — честно сообщаем).
// ---------------------------------------------------------------------------

import type { SalaryConfig } from '@/types';

export interface PayslipRecognition {
  config: Partial<SalaryConfig>;
  /** Человекочитаемые находки — показываем пользователю, что распознано. */
  found: string[];
}

/** Первое число после совпадения (поддержка «1 234,56» и «1234.56»). */
function numberAfter(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const raw = (m[m.length - 1] || '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(\d[\d\s]*(?:[.,]\d+)?)`;

/**
 * Распознать параметры оплаты из текста расчётного листка. Чистая функция —
 * легко тестировать; PDF-обёртка ниже только добывает текст.
 */
export function parsePayslipText(raw: string): PayslipRecognition {
  // Нормализуем: единые пробелы, нижний регистр для поиска (числа не трогаем).
  const text = raw.replace(/\s+/g, ' ').toLowerCase();
  const config: Partial<SalaryConfig> = {};
  const found: string[] = [];

  // Часовая тарифная ставка: «часовая тарифная ставка 350,50», «ставка, руб/час: 300»
  const hourRate =
    numberAfter(
      text,
      new RegExp(String.raw`часов[а-я]*\s+(?:тарифн[а-я]*\s+)?ставк[а-я]*\D{0,20}?${NUM}`),
    ) ??
    numberAfter(
      text,
      new RegExp(
        String.raw`ставк[а-я]*[^.\d]{0,20}(?:руб[а-я.]*\s*/?\s*час|₽\s*/\s*ч)\D{0,10}?${NUM}`,
      ),
    ) ??
    numberAfter(text, new RegExp(String.raw`тариф\D{0,15}?${NUM}\s*(?:руб[а-я.]*)?\s*/?\s*час`));
  if (hourRate && hourRate > 10 && hourRate < 100000) {
    config.rateMode = 'hourly';
    config.hourRate = hourRate;
    found.push(`Часовая ставка: ${hourRate} ₽`);
  }

  // Оклад (если часовой ставки нет): «оклад 85 000»
  if (!config.hourRate) {
    const monthly = numberAfter(text, new RegExp(String.raw`оклад\D{0,20}?${NUM}`));
    if (monthly && monthly > 1000) {
      config.rateMode = 'monthly';
      config.monthlyBase = monthly;
      found.push(`Оклад: ${monthly} ₽`);
    }
  }

  // Районный коэффициент: «районный коэффициент 1,7» или «70%»
  const district = numberAfter(
    text,
    new RegExp(String.raw`районн[а-я]*\s+коэффициент[а-я]*\D{0,20}?${NUM}`),
  );
  if (district) {
    // 70 → 1.7; 1.7 → 1.7
    const coeff = district > 10 ? 1 + district / 100 : district;
    if (coeff > 1 && coeff <= 3) {
      config.districtEnabled = true;
      config.districtCoeff = Math.round(coeff * 100) / 100;
      found.push(`Районный коэффициент: ×${config.districtCoeff}`);
    }
  }

  // Северная надбавка: «северная надбавка 80%»
  const north = numberAfter(
    text,
    new RegExp(String.raw`северн[а-я]*\s+надбавк[а-я]*\D{0,20}?${NUM}`),
  );
  if (north && north > 0 && north <= 100) {
    config.northEnabled = true;
    config.northPercent = north;
    found.push(`Северная надбавка: ${north}%`);
  }

  // Премия: «премия 30%» или «премия ежемесячная 15 000»
  const premium = numberAfter(text, new RegExp(String.raw`преми[а-я]*\D{0,30}?${NUM}\s*%`));
  if (premium && premium > 0 && premium <= 300) {
    config.premiumEnabled = true;
    config.premiumMode = 'percent';
    config.premiumValue = premium;
    found.push(`Премия: ${premium}%`);
  } else {
    const premiumFixed = numberAfter(text, new RegExp(String.raw`преми[а-я]*\D{0,30}?${NUM}`));
    if (premiumFixed && premiumFixed > 500) {
      config.premiumEnabled = true;
      config.premiumMode = 'fixed';
      config.premiumValue = premiumFixed;
      found.push(`Премия: ${premiumFixed} ₽`);
    }
  }

  // Вахтовая надбавка: «надбавка за вахтовый метод работы (30 дн. по 700,00)».
  // В окне после слова «вахтов…» может быть несколько чисел (дни, ставка,
  // сумма) — берём первое похожее на дневную ставку (100…10 000 ₽).
  const vahtaWindow = text.match(/вахтов[а-я]*(.{0,60})/);
  if (vahtaWindow) {
    const nums = [...vahtaWindow[1].matchAll(/\d[\d\s]*(?:[.,]\d+)?/g)].map((m) =>
      parseFloat(m[0].replace(/\s/g, '').replace(',', '.')),
    );
    const perDay = nums.find((n) => n >= 100 && n <= 10000);
    if (perDay) {
      config.vahtaEnabled = true;
      config.vahtaAllowancePerDay = perDay;
      found.push(`Вахтовая надбавка: ${perDay} ₽/день`);
    }
  }

  // Ночные: «доплата за ночные … 40%»
  const night = numberAfter(text, new RegExp(String.raw`ночн[а-я]*[^.\d]{0,40}?${NUM}\s*%`));
  if (night && night >= 10 && night <= 100) {
    config.nightEnabled = true;
    config.nightPercent = night;
    found.push(`Ночные: ${night}%`);
  }

  // НДФЛ: «ндфл 13%» или просто упоминание → 13
  const ndfl = numberAfter(text, new RegExp(String.raw`ндфл\D{0,15}?${NUM}\s*%?`));
  if (text.includes('ндфл')) {
    config.ndflEnabled = true;
    config.ndflPercent = ndfl && ndfl >= 5 && ndfl <= 25 ? ndfl : 13;
    found.push(`НДФЛ: ${config.ndflPercent}%`);
  }

  return { config, found };
}

/**
 * Извлечь текст из PDF-файла (pdfjs подгружается лениво, ~в отдельном чанке)
 * и распознать параметры. Бросает Error('no_text'), если текстовый слой пуст
 * (например, это скан-картинка).
 */
export async function recognizePayslipPdf(file: File): Promise<PayslipRecognition> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  let text = '';
  const pages = Math.min(doc.numPages, 5); // расчётный листок — 1–2 страницы
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  if (text.replace(/\s/g, '').length < 40) throw new Error('no_text');
  return parsePayslipText(text);
}
