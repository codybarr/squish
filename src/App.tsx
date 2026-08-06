import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type OutputFormat = "jpg" | "png" | "webp" | "avif";
type Status = "queued" | "working" | "done" | "error";

type Item = {
  id: string;
  file: File;
  status: Status;
  originalUrl: string;
  outputUrl?: string;
  outputName?: string;
  originalBytes: number;
  outputBytes?: number;
  width?: number;
  height?: number;
  error?: string;
};

type WorkerResponse =
  | {
      type: "done";
      id: string;
      blob: Blob;
      width: number;
      height: number;
      originalBytes: number;
      outputBytes: number;
      outputName: string;
    }
  | { type: "error"; id: string; message: string };

const formats: { value: OutputFormat; label: string; note: string }[] = [
  { value: "avif", label: "AVIF", note: "smallest" },
  { value: "webp", label: "WebP", note: "fast web" },
  { value: "jpg", label: "JPG", note: "photos" },
  { value: "png", label: "PNG", note: "lossless / large" },
];

const supportedTypes = ["image/png", "image/jpeg", "image/avif", "image/webp"];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function bytes(value?: number) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = units[0];
  for (let i = 1; size >= 1024 && i < units.length; i++) {
    size /= 1024;
    unit = units[i];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function savings(original: number, output?: number) {
  if (!output) return "";
  const delta = 1 - output / original;
  if (delta >= 0) return `${Math.round(delta * 100)}% smaller`;
  return `${Math.round(Math.abs(delta) * 100)}% larger`;
}

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<OutputFormat>("avif");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [lockAspect, setLockAspect] = useState(true);
  const [dragging, setDragging] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const itemsRef = useRef<Item[]>([]);
  const settingsRef = useRef({
    format,
    resize: {
      width: undefined as number | undefined,
      height: undefined as number | undefined,
      lockAspect: true,
    },
  });

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    let disposed = false;

    const createWorker = () => {
      const worker = new Worker("/codec.worker.js", { type: "module" });

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        if (data.type === "done") {
          const outputUrl = URL.createObjectURL(data.blob);
          setItems((current) =>
            current.map((item) => {
              if (item.id !== data.id) return item;
              if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
              return {
                ...item,
                status: "done",
                outputUrl,
                outputName: data.outputName,
                outputBytes: data.outputBytes,
                originalBytes: data.originalBytes,
                width: data.width,
                height: data.height,
              };
            }),
          );
        } else {
          setItems((current) =>
            current.map((item) =>
              item.id === data.id
                ? { ...item, status: "error", error: data.message }
                : item,
            ),
          );
        }
        activeRef.current = false;
        activeIdRef.current = null;
        runNext();
      };

      const handleWorkerFailure = (message: string) => {
        if (workerRef.current !== worker) return;

        const failedId = activeIdRef.current;
        if (failedId) {
          setItems((current) =>
            current.map((item) =>
              item.id === failedId
                ? { ...item, status: "error", error: message }
                : item,
            ),
          );
        }

        activeRef.current = false;
        activeIdRef.current = null;
        worker.terminate();

        if (!disposed && failedId) {
          workerRef.current = createWorker();
          window.setTimeout(runNext, 0);
        } else {
          workerRef.current = null;
        }
      };

      worker.onerror = (event) => {
        event.preventDefault();
        handleWorkerFailure(
          event.message || "The image codec worker crashed unexpectedly.",
        );
      };
      worker.onmessageerror = () =>
        handleWorkerFailure("The image codec returned an unreadable response.");

      return worker;
    };

    workerRef.current = createWorker();

    return () => {
      disposed = true;
      workerRef.current?.terminate();
      workerRef.current = null;
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.originalUrl);
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      });
    };
  }, []);

  const resizeSettings = useMemo(
    () => ({
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
      lockAspect,
    }),
    [width, height, lockAspect],
  );

  useEffect(() => {
    settingsRef.current = { format, resize: resizeSettings };
  }, [format, resizeSettings]);

  const runNext = useCallback(async () => {
    if (activeRef.current || !workerRef.current) return;
    const nextId = queueRef.current.shift();
    if (!nextId) return;
    const item = itemsRef.current.find((candidate) => candidate.id === nextId);
    if (!item) return runNext();

    activeRef.current = true;
    activeIdRef.current = nextId;
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === nextId
          ? { ...candidate, status: "working" }
          : candidate,
      ),
    );

    try {
      const buffer = await item.file.arrayBuffer();
      const settings = settingsRef.current;
      workerRef.current.postMessage(
        {
          type: "process",
          job: {
            id: item.id,
            fileName: item.file.name,
            sourceType: item.file.type,
            buffer,
            format: settings.format,
            resize: settings.resize,
          },
        },
        [buffer],
      );
    } catch (error) {
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === nextId
            ? {
                ...candidate,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              }
            : candidate,
        ),
      );
      activeRef.current = false;
      activeIdRef.current = null;
      runNext();
    }
  }, []);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const imageFiles = Array.from(fileList).filter(
        (file) =>
          supportedTypes.includes(file.type) ||
          /\.(png|jpe?g|webp|avif)$/i.test(file.name),
      );
      if (!imageFiles.length) return;

      const fresh = imageFiles.map<Item>((file) => ({
        id: uid(),
        file,
        status: "queued",
        originalUrl: URL.createObjectURL(file),
        originalBytes: file.size,
      }));

      queueRef.current.push(...fresh.map((item) => item.id));
      setItems((current) => [...fresh, ...current]);
      window.setTimeout(runNext, 0);
    },
    [runNext],
  );

  const reprocessAll = useCallback(() => {
    const ready = itemsRef.current.map((item) => item.id);
    queueRef.current = ready;
    setItems((current) =>
      current.map((item) => {
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
        return {
          ...item,
          status: "queued",
          outputUrl: undefined,
          outputName: undefined,
          outputBytes: undefined,
          error: undefined,
        };
      }),
    );
    activeRef.current = false;
    runNext();
  }, [runNext]);

  const clearAll = useCallback(() => {
    queueRef.current = [];
    activeRef.current = false;
    activeIdRef.current = null;
    setItems((current) => {
      current.forEach((item) => {
        URL.revokeObjectURL(item.originalUrl);
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      });
      return [];
    });
  }, []);

  const downloadAll = useCallback(() => {
    itemsRef.current
      .filter((item) => item.outputUrl)
      .forEach((item, index) => {
        window.setTimeout(() => {
          const anchor = document.createElement("a");
          anchor.href = item.outputUrl!;
          anchor.download = item.outputName || item.file.name;
          anchor.click();
        }, index * 150);
      });
  }, []);

  const completed = items.filter((item) => item.status === "done").length;
  const working = items.some(
    (item) => item.status === "working" || item.status === "queued",
  );
  const originalTotal = items.reduce(
    (sum, item) => sum + item.originalBytes,
    0,
  );
  const outputTotal = items.reduce(
    (sum, item) => sum + (item.outputBytes || 0),
    0,
  );

  return (
    <main className="shell">
      <section className="hero">
        <h1>Squish an entire folder before your coffee cools.</h1>
        <div className="eyebrow">WASM codecs · local only · bulk first</div>
        <p>
          Drop PNG, JPG, AVIF, or WebP files. Squish decodes, resizes, converts,
          and recompresses them in your browser—no upload server, no codec
          knobs, no quality-slider homework.
        </p>
      </section>

      <section className="console" aria-label="Image compression controls">
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <input
            id="file-input"
            type="file"
            accept="image/png,image/jpeg,image/avif,image/webp"
            multiple
            onChange={(event) =>
              event.target.files && addFiles(event.target.files)
            }
          />
          <label htmlFor="file-input">
            <span className="dropGlyph">⇣</span>
            <strong>Drop a batch here</strong>
            <small>
              or click to choose individual files / multiple selections
            </small>
          </label>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <span>Output format</span>
            <em>defaults are tuned</em>
          </div>
          <div className="formatGrid">
            {formats.map((option) => (
              <button
                key={option.value}
                className={format === option.value ? "selected" : ""}
                onClick={() => setFormat(option.value)}
              >
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </button>
            ))}
          </div>

          {format === "png" && (
            <div className="formatWarning" role="note">
              PNG is lossless. Converting camera JPGs to PNG often makes them
              much larger; use AVIF/WebP/JPG to actually shrink photos.
            </div>
          )}

          <div className="resizeBox">
            <div className="panelHeader">
              <span>Optional resize</span>
              <em>Lanczos3</em>
            </div>
            <div className="sizeInputs">
              <label>
                Width
                <input
                  inputMode="numeric"
                  min="1"
                  type="number"
                  placeholder="auto"
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                />
              </label>
              <label>
                Height
                <input
                  inputMode="numeric"
                  min="1"
                  type="number"
                  placeholder="auto"
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                />
              </label>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={lockAspect}
                onChange={(event) => setLockAspect(event.target.checked)}
              />
              <span>Lock aspect ratio</span>
            </label>
          </div>
        </div>
      </section>

      <section className="stats">
        <div>
          <strong>{items.length}</strong>
          <span>queued images</span>
        </div>
        <div>
          <strong>{completed}</strong>
          <span>finished</span>
        </div>
        <div>
          <strong>{bytes(originalTotal)}</strong>
          <span>input total</span>
        </div>
        <div>
          <strong>{outputTotal ? bytes(outputTotal) : "—"}</strong>
          <span>
            {outputTotal ? savings(originalTotal, outputTotal) : "output total"}
          </span>
        </div>
      </section>

      {items.length > 0 && (
        <div className="actions">
          <button onClick={reprocessAll} disabled={working}>
            Re-squish with current settings
          </button>
          <button onClick={downloadAll} disabled={!completed}>
            Download all finished
          </button>
          <button className="ghost" onClick={clearAll}>
            Clear
          </button>
        </div>
      )}

      <section className="queue" aria-label="Image queue">
        {items.map((item) => (
          <article className={`card ${item.status}`} key={item.id}>
            <img src={item.outputUrl || item.originalUrl} alt="" />
            <div className="cardBody">
              <div className="nameRow">
                <h2 title={item.file.name}>{item.file.name}</h2>
                <span>{item.status}</span>
              </div>
              <div className="meter">
                <i
                  style={{
                    width:
                      item.status === "done"
                        ? "100%"
                        : item.status === "working"
                          ? "62%"
                          : item.status === "error"
                            ? "100%"
                            : "18%",
                  }}
                />
              </div>
              {item.error ? (
                <p className="error">{item.error}</p>
              ) : (
                <p>
                  {bytes(item.originalBytes)} → {bytes(item.outputBytes)}{" "}
                  {item.outputBytes
                    ? `· ${savings(item.originalBytes, item.outputBytes)}`
                    : ""}
                  {format === "png" &&
                  item.file.type === "image/jpeg" &&
                  item.outputBytes &&
                  item.outputBytes > item.originalBytes ? (
                    <em className="expected">Expected for JPG→PNG photos</em>
                  ) : null}
                </p>
              )}
              <div className="meta">
                <span>
                  {item.width && item.height
                    ? `${item.width} × ${item.height}`
                    : "waiting for dimensions"}
                </span>
                {item.outputUrl && (
                  <a href={item.outputUrl} download={item.outputName}>
                    Download
                  </a>
                )}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
