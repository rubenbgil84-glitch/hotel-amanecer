const maximumOriginalBytes = 20 * 1024 * 1024;
const maximumOptimizedBytes = 5 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function optimizeImageToDataUrl(file: File): Promise<string> {
  if (!allowedImageTypes.has(file.type)) {
    throw new Error('Solo se admiten fotos JPG, PNG o WebP.');
  }
  if (file.size > maximumOriginalBytes) {
    throw new Error('Cada foto original debe ocupar menos de 20 MB.');
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No se pudo leer una de las imágenes seleccionadas.'));
    });

    let scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Este navegador no permite optimizar la imagen.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (!blob) throw new Error('No se pudo convertir una imagen a WebP.');
      if (blob.size <= maximumOptimizedBytes) break;
      scale *= 0.78;
    }
    if (!blob || blob.size > maximumOptimizedBytes) {
      throw new Error('No se pudo reducir la foto a menos de 5 MB. Prueba con una imagen más pequeña.');
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('No se pudo preparar la imagen.'));
      reader.onerror = () => reject(new Error('No se pudo leer la imagen optimizada.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
