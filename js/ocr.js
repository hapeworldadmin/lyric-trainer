// Loaded only after Scan screenshot. The image stays in the browser.

const SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

function loadEngine(doc = globalThis.document) {
  const existing = globalThis.Tesseract;
  if (existing?.createWorker) return Promise.resolve(existing);
  if (!doc) return Promise.reject(new Error("unavailable"));
  return new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      if (globalThis.Tesseract?.createWorker) resolve(globalThis.Tesseract);
      else reject(new Error("unavailable"));
    };
    script.onerror = () => reject(new Error("unavailable"));
    doc.head.appendChild(script);
  });
}

export async function recognizeImage(file, doc = globalThis.document) {
  const engine = await loadEngine(doc);
  const worker = await engine.createWorker("eng");
  try {
    const result = await worker.recognize(file);
    return String(result?.data?.text || "");
  } finally {
    await worker.terminate();
  }
}
