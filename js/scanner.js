// Reads a barcode with the camera. Uses the browser's own reader when it has one,
// otherwise loads ZXing (bundled in js/vendor, only fetched the first time you scan).

let zxingPromise = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/zxing.min.js';
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { zxingPromise = null; reject(new Error('Could not load the barcode reader.')); };
      document.head.appendChild(s);
    });
  }
  return zxingPromise;
}

// Starts the camera in `video` and calls onCode once with the first barcode it sees.
// Returns a stop() function.
export async function startScanner(video, onCode) {
  let stopped = false;
  let stopFn = () => {};
  const stop = () => { stopped = true; stopFn(); };

  if ('BarcodeDetector' in window) {
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
    stopFn = () => stream.getTracks().forEach((t) => t.stop());
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) { stop(); onCode(codes[0].rawValue); return; }
      } catch { /* try the next frame */ }
      setTimeout(tick, 200);
    };
    tick();
    return stop;
  }

  const ZXing = await loadZxing();
  if (stopped) return stop;
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
  ]);
  const reader = new ZXing.BrowserMultiFormatReader(hints);
  stopFn = () => reader.reset();
  await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, (result) => {
    if (result && !stopped) { stop(); onCode(result.getText()); }
  });
  return stop;
}
