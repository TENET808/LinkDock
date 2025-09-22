// scripts/make-ico.js
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const pngPath = path.join(__dirname, '..', 'build', 'icon.png');
    const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');

    const pngExists = fs.existsSync(pngPath);
    const icoExists = fs.existsSync(icoPath);

    if (!pngExists && !icoExists) {
      console.log('[make-ico] Нет build/icon.png и build/icon.ico — пропускаю.');
      process.exit(0);
    }

    if (icoExists && fs.statSync(icoPath).size > 0) {
      console.log('[make-ico] build/icon.ico уже есть — пропускаю.');
      process.exit(0);
    }

    if (!pngExists) {
      console.log('[make-ico] PNG нет, но есть пустой ICO — пропускаю.');
      process.exit(0);
    }

    console.log('[make-ico] Генерирую build/icon.ico из build/icon.png …');
    const pngToIco = require('png-to-ico');
    const buffer = await pngToIco(pngPath);
    fs.writeFileSync(icoPath, buffer);
    console.log('[make-ico] Готово:', icoPath);
  } catch (e) {
    console.warn('[make-ico] Предупреждение:', e.message);
    // не валим сборку — electron-builder просто упадёт позже, если иконки реально нет
    process.exit(0);
  }
})();
