// Reads the text in a photo (a receipt), on the device. Uses Tesseract
// (bundled in js/vendor/tesseract, Apache 2.0), loaded the first time it's needed.

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/tesseract/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { loading = null; reject(new Error('Couldn’t load the receipt reader.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// Receipts are long and thin; a big, grey, high-contrast picture reads best.
async function prepare(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.4)';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readImageText(file, onProgress = () => {}) {
  const Tesseract = await loadTesseract();
  const base = new URL('js/vendor/tesseract/', location.href).href;
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress || 0); },
  });
  try {
    const canvas = await prepare(file);
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}
