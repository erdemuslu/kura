/**
 * Brand app-icon.png tasarım kaynağıdır (export/kura-icon-1024).
 * Bu script eski prosedürel ikonu YAZMAZ; mevcut app-icon.png'den
 * Tauri ikon setini (src-tauri/icons/) yeniden üretir.
 *
 * Kullanım: npm run icon
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('app-icon.png')) {
  console.error(
    'app-icon.png bulunamadı. Export’taki kura-icon-1024.png dosyasını kökte app-icon.png olarak koyun.',
  );
  process.exit(1);
}

const result = spawnSync('npx', ['tauri', 'icon', 'app-icon.png'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
