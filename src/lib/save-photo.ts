/** Save a photo (a data URL) to the phone's gallery, or download it in a browser. */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

const Gallery = registerPlugin<{ saveImage(options: { data: string; name: string }): Promise<{ saved: boolean }> }>("Gallery");

export async function savePhoto(dataUrl: string, name = `atlas-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`) {
  if (nativeApp) {
    await Gallery.saveImage({ data: dataUrl, name });
    return "Saved to your gallery (Pictures › American Atlas).";
  }
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  return "Downloaded.";
}
