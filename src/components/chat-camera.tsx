/**
 * Take a picture without leaving the chat: the camera fills the screen, the
 * big button takes it, then you can put a caption bar across it and slap
 * stickers on (drag them; two fingers to turn and resize), and send. What you
 * see is what's sent: the photo is cropped to the screen, and the caption and
 * stickers are drawn into it.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Images, MapPin, MapPinOff, RefreshCw, Send, Smile, Sparkles, Type, X } from "lucide-react";
import { StickerArt, StickerTray } from "@/components/chat-stickers";
import { allowCamera } from "@/lib/mic";
import { useSettings } from "@/lib/atlas-settings";
import { enhancePhoto } from "@/lib/photo-enhance";
import { pushBack } from "@/lib/sheet-back";

type Placed = { key: number; id: string; x: number; y: number; scale: number; turn: number };

/** Where the photo sits on screen (contained, so all of it shows). */
function fitRect(width: number, height: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / width, boxH / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that picture"));
    img.src = src;
  });
}

/** A sticker on screen, as a picture for the canvas. */
async function svgImage(svg: SVGSVGElement) {
  const text = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    return await loadImage(url);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function ChatCamera({
  icon,
  color,
  canPlace,
  sendLabel = "Send",
  onClose,
  onSend,
}: {
  /** Your map avatar, for the "you" stickers. */
  icon: string;
  color: string;
  /** There's a location to send with it. */
  canPlace: boolean;
  /** "Send to…" when who gets it is picked next. */
  sendLabel?: string;
  onClose: () => void;
  onSend: (file: File, withPlace: boolean) => Promise<void> | void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by "Try again". */
  const [attempt, setAttempt] = useState(0);
  const snapInput = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(false);
  /**
   * The picture taken (or picked) and its size: as the camera took it, and
   * (for one taken here) made to look its best, which is a moment behind.
   */
  const [shot, setShot] = useState<{ raw: string; fine: string | null; camera: boolean; w: number; h: number } | null>(null);
  const enhance = useSettings((state) => state.enhancePhotos);
  const setEnhance = useSettings((state) => state.setEnhancePhotos);
  const shown = shot ? (enhance && shot.fine ? shot.fine : shot.raw) : "";
  /** 1 to 3. The camera's own zoom where it has one, else the middle of the picture, cropped. */
  const [zoom, setZoom] = useState(1);
  const hwZoom = useRef<{ min: number; max: number } | null>(null);
  const [hwOk, setHwOk] = useState(false);
  const [caption, setCaption] = useState<{ text: string; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [tray, setTray] = useState(false);
  const [withPlace, setWithPlace] = useState(canPlace);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const nextKey = useRef(1);
  const captionBox = useRef<HTMLInputElement>(null);
  /** A tap that only puts a chosen sticker down doesn't start a caption too. */
  const hadChosen = useRef(false);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  // Back: the sticker drawer, then the picture (retake), then the camera.
  useEffect(
    () =>
      pushBack(() => {
        if (tray) setTray(false);
        else if (shot) retake();
        else onClose();
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tray, shot],
  );

  // The camera runs only while there's no picture yet.
  useEffect(() => {
    if (shot) return;
    let dead = false;
    setLive(false);
    setError(null);
    const stop = () => {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
    /** getUserMedia, but not forever (a stream that turns up late is switched straight off). */
    const ask = (wanted: MediaTrackConstraints | true, ms: number) =>
      new Promise<MediaStream>((resolve, reject) => {
        let done = false;
        const timer = window.setTimeout(() => {
          done = true;
          reject(new DOMException("timeout", "TimeoutError"));
        }, ms);
        navigator.mediaDevices.getUserMedia({ video: wanted, audio: false }).then(
          (media) => {
            window.clearTimeout(timer);
            if (done || dead) media.getTracks().forEach((track) => track.stop());
            else {
              done = true;
              resolve(media);
            }
          },
          (err) => {
            window.clearTimeout(timer);
            if (!done) {
              done = true;
              reject(err);
            }
          },
        );
      });
    /** Pictures are actually coming in (some phones hand over a stream that never shows anything). */
    const showing = (node: HTMLVideoElement, ms: number) =>
      new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const look = () => {
          if (dead) resolve(false);
          else if (node.videoWidth > 0 && node.readyState >= 2) resolve(true);
          else if (performance.now() - t0 > ms) resolve(false);
          else window.setTimeout(look, 100);
        };
        look();
      });
    void (async () => {
      let last: unknown = null;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("none", "NotSupportedError");
        // The phone's permission ask, but never stuck on it: the camera itself asks too.
        await Promise.race([allowCamera(), new Promise<void>((resolve) => window.setTimeout(resolve, 15000))]).catch((err) => {
          if (String(err?.message ?? err).includes("denied")) throw new DOMException("denied", "NotAllowedError");
        });
        // A sharp picture first; if this phone's camera won't start that way, plainer.
        // (zoom: true asks for the camera's own zoom; a phone without it ignores that.)
        const tries: (MediaTrackConstraints | true)[] = [
          { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, zoom: true } as MediaTrackConstraints,
          { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          { facingMode: { ideal: facing } },
          true,
        ];
        for (const wanted of tries) {
          if (dead) return;
          try {
            const media = await ask(wanted, 6000);
            stream.current = media;
            const node = video.current;
            if (!node) return;
            node.muted = true;
            node.srcObject = media;
            void node.play().catch(() => undefined);
            if (await showing(node, 4000)) {
              if (dead) return;
              // The camera's own zoom, if it has one (sharper than cropping).
              const track = media.getVideoTracks()[0];
              const caps = (track?.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } };
              hwZoom.current = caps.zoom && caps.zoom.max > caps.zoom.min && caps.zoom.min > 0 ? { min: caps.zoom.min, max: caps.zoom.max } : null;
              setHwOk(Boolean(hwZoom.current));
              setZoom(1);
              setLive(true);
              return;
            }
            stop();
            last = new DOMException("no picture", "NotReadableError");
          } catch (err) {
            last = err;
            // No permission: asking another way won't help.
            if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw err;
          }
        }
        throw last ?? new DOMException("none", "NotReadableError");
      } catch (err) {
        if (dead) return;
        stop();
        const name = err instanceof Error || err instanceof DOMException ? err.name : "";
        const denied = name === "NotAllowedError" || name === "SecurityError";
        setError(denied ? "The camera needs permission. Allow the camera for this app in the phone's settings." : `The camera here didn't start${name && name !== "Error" ? ` (${name})` : ""}.`);
      }
    })();
    return () => {
      dead = true;
      stop();
    };
  }, [facing, shot, attempt]);

  // How much of the zoom the camera does itself, and how much is a crop of the middle.
  const hwRange = hwOk && hwZoom.current ? hwZoom.current.max / hwZoom.current.min : 1;
  const hwPart = Math.min(zoom, hwRange);
  const cropZoom = zoom / hwPart;
  useEffect(() => {
    const track = stream.current?.getVideoTracks()[0];
    const hw = hwZoom.current;
    if (!live || !track || !hw || !hwOk) return;
    const id = window.requestAnimationFrame(() => {
      track.applyConstraints({ advanced: [{ zoom: Math.min(hw.max, hw.min * hwPart) } as MediaTrackConstraintSet] }).catch(() => {
        // It said it could zoom, then couldn't: crop instead.
        hwZoom.current = null;
        setHwOk(false);
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [hwOk, hwPart, live]);

  // Two fingers on the picture zoom (1 to 3).
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const spread = () => {
    const [a, b] = [...fingers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function retake() {
    setShot(null);
    setCaption(null);
    setPlaced([]);
    setChosen(null);
    setEditing(false);
  }

  function take() {
    const node = video.current;
    if (!node || !node.videoWidth || !size.w) return;
    // Crop to what was on screen (the preview fills it), and to the zoom if it's a crop.
    const vw = node.videoWidth;
    const vh = node.videoHeight;
    const scale = Math.max(size.w / vw, size.h / vh) * cropZoom;
    const cw = size.w / scale;
    const ch = size.h / scale;
    const sx = (vw - cw) / 2;
    const sy = (vh - ch) / 2;
    const edge = Math.min(1600, Math.max(cw, ch));
    const out = edge / Math.max(cw, ch);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * out);
    canvas.height = Math.round(ch * out);
    const g = canvas.getContext("2d");
    if (!g) return;
    if (facing === "user") {
      // The front camera shows a mirror; keep the picture the way it looked.
      g.translate(canvas.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(node, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    landed(canvas, true);
  }

  /** A picture is in: show it now, and work on the good-camera version just after. */
  function landed(canvas: HTMLCanvasElement, camera: boolean) {
    const raw = canvas.toDataURL("image/jpeg", 0.9);
    setShot({ raw, fine: null, camera, w: canvas.width, h: canvas.height });
    if (!camera) return;
    window.setTimeout(() => {
      try {
        enhancePhoto(canvas);
        const fine = canvas.toDataURL("image/jpeg", 0.9);
        setShot((cur) => (cur && cur.raw === raw ? { ...cur, fine } : cur));
      } catch {
        // Then it's sent as the camera took it.
      }
    }, 30);
  }

  function picked(file: File, camera = false) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const img = await loadImage(String(reader.result));
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        landed(canvas, camera);
      } catch {
        setError("Couldn't read that photo.");
      }
    };
    reader.readAsDataURL(file);
  }

  const rect = shot && size.w ? fitRect(shot.w, shot.h, size.w, size.h) : null;

  function addSticker(id: string) {
    const key = nextKey.current++;
    setPlaced((list) => [...list, { key, id, x: 0.5, y: 0.42, scale: 1, turn: (Math.random() - 0.5) * 16 }]);
    setChosen(key);
    setTray(false);
  }

  function startCaption() {
    setCaption((cur) => cur ?? { text: "", y: 0.62 });
    setEditing(true);
    window.setTimeout(() => captionBox.current?.focus(), 30);
  }

  // Moving stickers: one finger drags, two fingers turn and resize.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ key: number; start: Placed; points: Map<number, { x: number; y: number }> } | null>(null);
  function stickerDown(event: ReactPointerEvent, item: Placed) {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = { key: item.key, start: { ...item }, points: new Map(touches.current) };
    setChosen(item.key);
    // The newest sticker touched goes on top.
    setPlaced((list) => [...list.filter((p) => p.key !== item.key), list.find((p) => p.key === item.key) ?? item]);
  }
  function stickerMove(event: ReactPointerEvent) {
    const g = gesture.current;
    if (!g || !rect || !touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const ids = [...g.points.keys()].filter((id) => touches.current.has(id));
    if (!ids.length) return;
    const now = ids.map((id) => touches.current.get(id) as { x: number; y: number });
    const was = ids.map((id) => g.points.get(id) as { x: number; y: number });
    const mid = (list: { x: number; y: number }[]) => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length });
    const a = mid(now);
    const b = mid(was);
    let scale = g.start.scale;
    let turn = g.start.turn;
    if (now.length >= 2) {
      const span = (p: { x: number; y: number }[]) => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      const angle = (p: { x: number; y: number }[]) => (Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) * 180) / Math.PI;
      scale = Math.max(0.4, Math.min(3.5, g.start.scale * (span(now) / Math.max(1, span(was)))));
      turn = g.start.turn + angle(now) - angle(was);
    }
    const x = Math.max(0, Math.min(1, g.start.x + (a.x - b.x) / rect.w));
    const y = Math.max(0, Math.min(1, g.start.y + (a.y - b.y) / rect.h));
    setPlaced((list) => list.map((p) => (p.key === g.key ? { ...p, x, y, scale, turn } : p)));
  }
  function stickerUp(event: ReactPointerEvent) {
    touches.current.delete(event.pointerId);
    const g = gesture.current;
    if (!g) return;
    // A finger lifted: carry on from here with the ones still down.
    const current = placedRef.current.find((p) => p.key === g.key);
    gesture.current = touches.current.size && current ? { key: g.key, start: { ...current }, points: new Map(touches.current) } : null;
  }
  const placedRef = useRef(placed);
  placedRef.current = placed;

  // The caption bar drags up and down; a tap types in it.
  const captionDrag = useRef<{ y0: number; start: number; moved: boolean } | null>(null);

  async function send() {
    if (!shot || !rect || busy) return;
    setBusy(true);
    setEditing(false);
    try {
      const img = await loadImage(shown);
      const canvas = document.createElement("canvas");
      canvas.width = shot.w;
      canvas.height = shot.h;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("Couldn't make the picture");
      g.drawImage(img, 0, 0);
      const k = shot.w / rect.w;
      if (caption?.text.trim()) {
        const barH = 40 * k;
        const y = caption.y * shot.h;
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect(0, y - barH / 2, shot.w, barH);
        g.fillStyle = "#fff";
        g.font = `600 ${17 * k}px Outfit, system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(caption.text.trim(), shot.w / 2, y, shot.w - 24 * k);
      }
      for (const item of placed) {
        const svg = box.current?.querySelector<SVGSVGElement>(`[data-sticker="${item.key}"] svg`);
        if (!svg) continue;
        const picture = await svgImage(svg);
        const side = STICKER_PX * item.scale * k;
        g.save();
        g.translate(item.x * shot.w, item.y * shot.h);
        g.rotate((item.turn * Math.PI) / 180);
        g.drawImage(picture, -side / 2, -side / 2, side, side);
        g.restore();
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("Couldn't make the picture");
      await onSend(new File([blob], `atlas-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() }), withPlace && canPlace);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it.");
      setBusy(false);
    }
  }

  const round = "grid size-11 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm active:bg-black/65";
  return createPortal(
    <div role="dialog" aria-label="Camera" className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <div
        ref={box}
        className={"relative min-h-0 flex-1 overflow-hidden" + (shot ? "" : " touch-none")}
        onPointerDown={(event) => {
          hadChosen.current = chosen != null;
          setChosen(null);
          if (shot || !live) return;
          fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (fingers.current.size === 2) pinch.current = { d0: Math.max(1, spread()), z0: zoom };
        }}
        onPointerMove={(event) => {
          if (!fingers.current.has(event.pointerId)) return;
          fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const p = pinch.current;
          if (p && fingers.current.size >= 2) setZoom(Math.max(1, Math.min(3, Math.round(p.z0 * (spread() / p.d0) * 10) / 10)));
        }}
        onPointerUp={(event) => {
          fingers.current.delete(event.pointerId);
          if (fingers.current.size < 2) pinch.current = null;
        }}
        onPointerCancel={(event) => {
          fingers.current.delete(event.pointerId);
          if (fingers.current.size < 2) pinch.current = null;
        }}
      >
        {!shot ? (
          // No poster: Android shows a big grey play button until the picture comes in.
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            poster={NO_POSTER}
            className={"absolute inset-0 size-full bg-black object-cover transition-opacity duration-200 " + (live ? "opacity-100" : "opacity-0")}
            style={{
              // A crop zoom is the middle of the picture, larger; the front camera is a mirror.
              transform: `scale(${(facing === "user" ? -1 : 1) * cropZoom}, ${cropZoom})`,
              // Roughly how it'll look made its best.
              filter: enhance ? "contrast(1.06) saturate(1.16) brightness(1.03)" : undefined,
            }}
          />
        ) : null}
        {shot && rect ? (
          <>
            <img src={shown} alt="The picture you took" className="absolute" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
            {/* Tap the picture to write on it. */}
            <button type="button" aria-label="Add a caption" className="absolute" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} onClick={() => (hadChosen.current ? undefined : startCaption())} />
            {caption ? (
              <div
                className="absolute flex h-10 items-center bg-black/55"
                style={{ left: rect.x, width: rect.w, top: rect.y + caption.y * rect.h - 20 }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (editing) return;
                  (event.currentTarget as Element).setPointerCapture(event.pointerId);
                  captionDrag.current = { y0: event.clientY, start: caption.y, moved: false };
                }}
                onPointerMove={(event) => {
                  const drag = captionDrag.current;
                  if (!drag) return;
                  const dy = event.clientY - drag.y0;
                  if (Math.abs(dy) > 6) drag.moved = true;
                  if (drag.moved) setCaption((cur) => (cur ? { ...cur, y: Math.max(0.06, Math.min(0.94, drag.start + dy / rect.h)) } : cur));
                }}
                onPointerUp={() => {
                  const drag = captionDrag.current;
                  captionDrag.current = null;
                  if (drag && !drag.moved) startCaption();
                }}
              >
                {editing ? (
                  <input
                    ref={captionBox}
                    value={caption.text}
                    maxLength={80}
                    onChange={(event) => setCaption((cur) => (cur ? { ...cur, text: event.target.value } : cur))}
                    onBlur={() => {
                      setEditing(false);
                      setCaption((cur) => (cur && cur.text.trim() ? cur : null));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                    }}
                    aria-label="Caption"
                    enterKeyHint="done"
                    className="h-full w-full bg-transparent px-3 text-center text-[17px] font-semibold text-white outline-none"
                  />
                ) : (
                  <p className="w-full truncate px-3 text-center text-[17px] font-semibold">{caption.text}</p>
                )}
              </div>
            ) : null}
            {placed.map((item) => (
              <div
                key={item.key}
                data-sticker={item.key}
                className="absolute touch-none"
                style={{
                  left: rect.x + item.x * rect.w - STICKER_PX / 2,
                  top: rect.y + item.y * rect.h - STICKER_PX / 2,
                  width: STICKER_PX,
                  height: STICKER_PX,
                  transform: `rotate(${item.turn}deg) scale(${item.scale})`,
                }}
                onPointerDown={(event) => stickerDown(event, item)}
                onPointerMove={stickerMove}
                onPointerUp={stickerUp}
                onPointerCancel={stickerUp}
              >
                <StickerArt id={item.id} icon={icon} color={color} size={STICKER_PX} still />
                {chosen === item.key ? (
                  <button
                    type="button"
                    aria-label="Take the sticker off"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      setPlaced((list) => list.filter((p) => p.key !== item.key));
                      setChosen(null);
                    }}
                    className="absolute -top-2 -right-2 grid size-8 place-items-center rounded-full bg-black/70 text-white"
                    style={{ transform: `scale(${1 / item.scale})` }}
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </>
        ) : null}
        {!shot && live ? (
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2" onPointerDown={(event) => event.stopPropagation()}>
            {[1, 2, 3].map((step) => {
              const near = zoom >= step - 0.5 && (step === 3 || zoom < step + 0.5);
              return (
                <button
                  key={step}
                  type="button"
                  aria-label={`Zoom ${step}×`}
                  aria-pressed={zoom === step}
                  onClick={() => setZoom(step)}
                  className={"grid h-9 min-w-9 place-items-center rounded-full px-2 text-xs font-semibold tabular-nums backdrop-blur-sm " + (near ? "bg-white/90 text-black" : "bg-black/45 text-white")}
                >
                  {near && zoom !== step ? `${zoom.toFixed(1)}×` : `${step}×`}
                </button>
              );
            })}
          </div>
        ) : null}
        {flash ? <div className="pointer-events-none absolute inset-0 bg-white" /> : null}
        {error && !shot ? (
          <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-2xl bg-white/10 p-4 text-center text-sm">
            <p>{error}</p>
            <button type="button" onClick={() => snapInput.current?.click()} className="mt-3 h-11 w-full rounded-full bg-white text-sm font-medium text-black">
              Use the phone's camera
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-11 rounded-full border border-white/30 text-sm">
                Try again
              </button>
              <button type="button" onClick={() => pick.current?.click()} className="h-11 rounded-full border border-white/30 text-sm">
                Pick a photo
              </button>
            </div>
          </div>
        ) : null}

        {/* Top: close or retake on the left, the tools on the right. */}
        <div className="safe-top absolute inset-x-0 top-0 flex items-start justify-between p-3">
          {shot ? (
            <button type="button" aria-label="Retake" onClick={retake} className={round}>
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <button type="button" aria-label="Close the camera" onClick={onClose} className={round}>
              <X className="size-5" />
            </button>
          )}
          {shot ? (
            <div className="flex flex-col gap-2">
              <button type="button" aria-label="Write on it" onClick={startCaption} className={round}>
                <Type className="size-5" />
              </button>
              <button type="button" aria-label="Stickers" onClick={() => setTray(true)} className={round}>
                <Smile className="size-5" />
              </button>
              {shot.camera ? (
                <button
                  type="button"
                  aria-label={enhance ? "Made to look its best (tap for as taken)" : "As taken (tap to make it look its best)"}
                  aria-pressed={enhance}
                  onClick={() => setEnhance(!enhance)}
                  className={round + (enhance ? " text-yellow-300" : " opacity-80")}
                >
                  <Sparkles className="size-5" />
                </button>
              ) : null}
              {canPlace ? (
                <button type="button" aria-label={withPlace ? "Sending where you are (tap to leave it off)" : "Not sending where you are (tap to add it)"} aria-pressed={withPlace} onClick={() => setWithPlace((v) => !v)} className={round}>
                  {withPlace ? <MapPin className="size-5" /> : <MapPinOff className="size-5 opacity-70" />}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button type="button" aria-label="Flip the camera" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className={round}>
                <RefreshCw className="size-5" />
              </button>
              <button
                type="button"
                aria-label={enhance ? "Making pictures look their best (tap to turn off)" : "Pictures as taken (tap to make them look their best)"}
                aria-pressed={enhance}
                onClick={() => setEnhance(!enhance)}
                className={round + (enhance ? " text-yellow-300" : " opacity-80")}
              >
                <Sparkles className="size-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: gallery, the big button, and (after) send. */}
      <div className="safe-bottom relative flex h-28 shrink-0 items-center justify-center bg-black">
        {!shot ? (
          <>
            <button type="button" aria-label="Pick a photo" onClick={() => pick.current?.click()} className="absolute left-6 grid size-12 place-items-center rounded-xl border border-white/30 text-white">
              <Images className="size-5" />
            </button>
            <button type="button" aria-label="Take the picture" disabled={!live} onClick={take} className="grid size-[76px] place-items-center rounded-full border-[5px] border-white disabled:opacity-40 active:scale-95">
              <span className="size-[58px] rounded-full bg-white" />
            </button>
          </>
        ) : (
          <>
            <p className="absolute left-5 max-w-[45%] text-xs text-white/60">{withPlace && canPlace ? "Sends where you are too" : "Tap the picture to write on it"}</p>
            <button type="button" disabled={busy} onClick={() => void send()} className="absolute right-5 flex h-12 items-center gap-2 rounded-full bg-white pr-5 pl-4 text-[15px] font-semibold text-black disabled:opacity-60">
              <Send className="size-4" />
              {busy ? "One moment…" : sendLabel}
            </button>
          </>
        )}
        {error && shot ? <p className="absolute inset-x-4 -top-8 text-center text-sm text-white">{error}</p> : null}
      </div>
      {/* The phone's own camera app, if the one in here won't start. */}
      <input
        ref={snapInput}
        type="file"
        accept="image/*"
        capture={facing === "user" ? "user" : "environment"}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) picked(file, true);
        }}
      />
      <input
        ref={pick}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) picked(file);
        }}
      />
      {tray ? (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/40" onClick={() => setTray(false)}>
          <div className="safe-bottom rounded-t-3xl bg-surface p-3 text-ink" onClick={(event) => event.stopPropagation()}>
            <StickerTray icon={icon} color={color} onPick={(sticker) => addSticker(sticker.id)} />
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/** A sticker's size on the picture before resizing, in screen pixels. */
const STICKER_PX = 120;

/** A see-through poster for the video, instead of Android's grey play button. */
const NO_POSTER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
