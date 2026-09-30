/**
 * Sayfa ve arayüz/görünüm geçişlerinde pencere ve gövde kaydırma pozisyonunu anında sıfırlar.
 */
export function resetScrollTop() {
  try {
    window.scrollTo(0, 0);
  } catch {}
  if (typeof document !== 'undefined') {
    if (document.documentElement) {
      document.documentElement.scrollTop = 0;
    }
    if (document.body) {
      document.body.scrollTop = 0;
    }
  }
}
