/**
 * Dosya yolu karşılaştırmaları için yardımcılar.
 * macOS APFS decomposed Unicode (NFD, örn: "Mu\u0308zik") ile
 * JS/girdi precomposed Unicode (NFC, örn: "M\u00fczik") arasındaki uyumsuzluğu,
 * sondaki boşlukları ve eğik çizgileri temizleyerek normalize eder.
 */
export function normalizePath(path?: string | null): string {
  if (!path) return '';
  return path.normalize('NFC').trim().replace(/[\/\\]+$/, '');
}

/**
 * Bir dosya veya klasör yolunun, kategori kaynak yolları kümesine
 * ait olup olmadığını kontrol eder.
 */
export function matchesCategoryPath(itemPath?: string | null, categoryPaths?: string[]): boolean {
  if (!categoryPaths || categoryPaths.length === 0) return true;
  if (!itemPath) return true;
  const normItem = normalizePath(itemPath).toLowerCase();
  if (!normItem) return true;
  return categoryPaths.some((catPath) => {
    const normCat = normalizePath(catPath).toLowerCase();
    if (!normCat) return false;
    return normItem.startsWith(normCat) || normCat.startsWith(normItem);
  });
}
