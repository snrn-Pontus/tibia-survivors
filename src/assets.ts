// Where the sprites come from. The game ships without CipSoft's artwork: players point it at their own Tibia
// client, the atlas is built in the browser (src/extract/) and kept in IndexedDB for the next visit.
// In development, public/assets/ from `npm run extract` wins.
import { Atlas, type AtlasData } from "./atlas";
import type { ExtractInput } from "./extract/extract";
import type { ExtractMessage, ExtractRequest } from "./extract/worker";
import game from "./tibia/data.json";
import terrain from "./tibia/terrain.json";

/** Bump when src/extract/ changes what it writes. */
const EXTRACTOR = 1;

const g = game as unknown as ExtractInput;
const INPUT: ExtractInput = {
  monsters: Object.fromEntries(Object.entries(g.monsters).map(([k, m]) => [k, { lookType: m.lookType, lookColors: m.lookColors }])),
  items: Object.fromEntries(Object.keys(g.items).map((k) => [k, 1])),
  fields: Object.fromEntries(Object.keys(g.fields ?? {}).map((k) => [k, 1])),
  terrain: terrain as unknown as ExtractInput["terrain"],
};

/** Changes whenever the game needs different sprites, so a cached atlas from an older build gets rebuilt. */
const VERSION = (() => {
  const s = `${EXTRACTOR}:${JSON.stringify(INPUT)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
})();

// ---------- IndexedDB ----------

interface Cached {
  version: string;
  data: AtlasData;
  png: Blob;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("tibia-survivors", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("atlas");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = op(d.transaction("atlas", mode).objectStore("atlas"));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function imageFrom(blob: Blob): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

export type AssetState = "ready" | "missing" | "outdated";

/** The atlas, if there is one: the dev build's extracted files, else the cached one. */
export async function loadAtlas(): Promise<{ atlas?: Atlas; state: AssetState }> {
  if (import.meta.env.DEV) {
    try {
      return { atlas: await Atlas.load(), state: "ready" };
    } catch {
      // not extracted with npm run extract: fall through to the browser's copy
    }
  }
  try {
    const c = await idb<Cached | undefined>("readonly", (s) => s.get("atlas"));
    if (!c) return { state: "missing" };
    if (c.version !== VERSION) return { state: "outdated" };
    return { atlas: new Atlas(await imageFrom(c.png), c.data), state: "ready" };
  } catch {
    return { state: "missing" };
  }
}

/** Forget the cached atlas, so the next visit asks for the client again. */
export async function clearAtlas() {
  await idb("readwrite", (s) => s.delete("atlas"));
}

/** Find the client's assets folder among picked files: the one holding catalog-content.json. Picking a
 *  folder above it (the whole Tibia install) works too. */
function assetFiles(files: File[]): Record<string, File> | null {
  const dirOf = (f: File) => (f.webkitRelativePath || f.name).replace(/[^/]*$/, "");
  const catalogs = files.filter((f) => f.name === "catalog-content.json").map(dirOf).sort((a, b) => a.length - b.length);
  if (!catalogs.length) return null;
  const dir = catalogs[0];
  const out: Record<string, File> = {};
  for (const f of files) if (dirOf(f) === dir) out[f.name] = f;
  return out;
}

/** Build the atlas from the picked client files (in a worker), cache it, and return it. */
export async function extractAtlas(picked: File[], progress: (done: number, total: number) => void): Promise<Atlas> {
  const files = assetFiles(picked);
  if (!files) throw new Error("No catalog-content.json in that folder. Pick Tibia's assets folder (or the folder it's in).");
  const worker = new Worker(new URL("./extract/worker.ts", import.meta.url), { type: "module" });
  const result = await new Promise<Extract<ExtractMessage, { type: "done" }>>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<ExtractMessage>) => {
      const m = e.data;
      if (m.type === "progress") progress(m.done, m.total);
      else if (m.type === "done") resolve(m);
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || "the extractor crashed"));
    worker.postMessage({ files, input: INPUT } satisfies ExtractRequest);
  }).finally(() => worker.terminate());

  const canvas = document.createElement("canvas");
  canvas.width = result.width;
  canvas.height = result.height;
  const px = new Uint8ClampedArray(result.pixels.buffer as ArrayBuffer, result.pixels.byteOffset, result.pixels.byteLength);
  canvas.getContext("2d")!.putImageData(new ImageData(px, result.width, result.height), 0, 0);
  const data = result.data as AtlasData;
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (png) await idb("readwrite", (s) => s.put({ version: VERSION, data, png } satisfies Cached, "atlas")).catch(() => {});
  return new Atlas(canvas, data);
}
