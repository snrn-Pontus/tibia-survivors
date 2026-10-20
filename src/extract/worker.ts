// Runs the extractor off the main thread: gets the client's files, posts progress and then the atlas.
import { extract, type ExtractInput } from "./extract";

export interface ExtractRequest {
  files: Record<string, File>; // by file name, from the client's assets folder
  input: ExtractInput;
}

export type ExtractMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; data: unknown; width: number; height: number; pixels: Uint8Array }
  | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<ExtractRequest>) => {
  const { files, input } = e.data;
  const post = (m: ExtractMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
  try {
    const read = async (name: string) => {
      const f = files[name];
      if (!f) throw new Error(`${name} is missing from the folder`);
      return new Uint8Array(await f.arrayBuffer());
    };
    let last = 0;
    const r = await extract(read, input, (done, total) => {
      const now = performance.now();
      if (now - last > 50 || done === total) {
        last = now;
        post({ type: "progress", done, total });
      }
    });
    post({ type: "done", data: r.data, width: r.width, height: r.height, pixels: r.pixels }, [r.pixels.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
