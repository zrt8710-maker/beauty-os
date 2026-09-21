type IngredientDisplayInput = {
  raw_name: string;
  normalized_name: string | null;
};

const JAPANESE_INCI_TO_CHINESE: Record<string, string> = {
  "水": "水",
  "パルミチン酸": "棕榈酸",
  "ミリスチン酸": "肉豆蔻酸",
  "グリセリン": "甘油",
  "ジグリセリン": "双甘油",
  "水酸化K": "氢氧化钾",
  "ラウリン酸": "月桂酸",
  "マカデミアナッツ脂肪酸フィトステリル": "澳洲坚果籽油脂肪酸植物甾醇酯",
  "ステアリン酸": "硬脂酸",
  "PEG-32": "PEG-32",
  "PEG-6": "PEG-6",
  "ソルビトール": "山梨醇",
  "ココイルメチルタウリンNa": "椰油酰甲基牛磺酸钠",
  "ココイルグリシンK": "椰油酰甘氨酸钾",
  "ココアンホ酢酸Na": "椰油两性乙酸钠",
  "ラウリルベタイン": "月桂基甜菜碱",
  "PEG-150": "PEG-150",
  "ポリクオタニウム-7": "聚季铵盐-7",
  "BG": "丁二醇",
  "DPG": "双丙甘醇",
  "エタノール": "乙醇",
  "フェノキシエタノール": "苯氧乙醇",
  "メチルパラベン": "羟苯甲酯",
  "プロピルパラベン": "羟苯丙酯",
  "EDTA-2Na": "EDTA 二钠",
  "クエン酸": "柠檬酸",
  "クエン酸Na": "柠檬酸钠",
  "香料": "香精",
};

const COMMON_INCI_TO_CHINESE: Record<string, string> = {
  WATER: "水",
  AQUA: "水",
  GLYCERIN: "甘油",
  PALMITIC_ACID: "棕榈酸",
  MYRISTIC_ACID: "肉豆蔻酸",
  LAURIC_ACID: "月桂酸",
  STEARIC_ACID: "硬脂酸",
  POTASSIUM_HYDROXIDE: "氢氧化钾",
  MACADAMIA_TERNIFOLIA_SEED_OIL: "澳洲坚果籽油",
};

/** Presentation-only Chinese display. It never changes persisted raw evidence. */
export function displayIngredientName(input: IngredientDisplayInput) {
  const normalized = input.normalized_name?.trim() ?? "";
  if (containsChinese(normalized)) return normalized;
  return JAPANESE_INCI_TO_CHINESE[input.raw_name]
    ?? (normalized ? COMMON_INCI_TO_CHINESE[normalizeInci(normalized)] : undefined)
    ?? JAPANESE_INCI_TO_CHINESE[normalized]
    ?? input.raw_name;
}

export function hasTranslatedIngredientDisplay(input: IngredientDisplayInput) {
  return displayIngredientName(input) !== input.raw_name;
}

function containsChinese(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function normalizeInci(value: string) {
  return value.toUpperCase().replace(/[\s-]+/g, "_");
}
