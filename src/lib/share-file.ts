import { nativeApp } from "@/lib/native";

/** Hand a text file to the phone's share sheet (the app), or download it (website). */
export async function shareTextFile(filename: string, text: string, mime: string, title: string): Promise<"shared" | "saved"> {
  if (nativeApp) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
    const file = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title, files: [file.uri], dialogTitle: title });
    return "shared";
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
