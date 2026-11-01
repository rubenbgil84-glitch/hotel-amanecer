import { Injectable } from '@angular/core';
import { createWorker, OEM } from 'tesseract.js';

@Injectable({ providedIn: 'root' })
export class DocumentOcrService {
  private workerPromise: ReturnType<typeof createWorker> | null = null;

  async recognize(file: File): Promise<string> {
    if (!this.workerPromise) {
      this.workerPromise = createWorker('spa', OEM.LSTM_ONLY, {
        workerPath: new URL('assets/tesseract/worker.min.js', document.baseURI).toString(),
        corePath: new URL('assets/tesseract/tesseract-core-lstm.wasm.js', document.baseURI).toString(),
        langPath: new URL('assets/tesseract/lang', document.baseURI).toString(),
        gzip: true,
        workerBlobURL: false,
      }).catch((error: unknown) => {
        this.workerPromise = null;
        throw error;
      });
    }

    const worker = await this.workerPromise;
    const { data } = await worker.recognize(file);
    return data.text;
  }
}
