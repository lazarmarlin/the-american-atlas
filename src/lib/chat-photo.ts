/** A photo for a chat message: the picture (sharp on a phone screen) and a small preview. */

function shrink(file: Blob, edge: number, quality: number) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, edge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const g = canvas.getContext("2d");
        if (!g) {
          reject(new Error("Couldn't read that photo"));
          return;
        }
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Couldn't read that photo"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** Within what the server takes (700 kB picture, 120 kB preview). */
export async function chatPhotoData(file: Blob) {
  // Big enough to look sharp on a phone screen (the old 640 px / 200 px ones were blurry).
  let image = await shrink(file, 1600, 0.82);
  if (image.length > 690000) image = await shrink(file, 1280, 0.75);
  if (image.length > 690000) throw new Error("Use a smaller photo");
  let thumb = await shrink(file, 540, 0.75);
  if (thumb.length > 115000) thumb = await shrink(file, 400, 0.65);
  return { image, thumb };
}
