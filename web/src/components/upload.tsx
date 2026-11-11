import { useQueryClient } from "@tanstack/react-query";
import { FileAudio, FileVideo, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { qk, uploadFile } from "@/lib/api";
import { bytes } from "@/lib/time";

export type UploadState = { id: string; name: string; size: number; progress: number; error?: string };

type Ctx = { pickFiles: () => void; addFiles: (files: File[]) => void; uploads: UploadState[] };
const UploadContext = createContext<Ctx | null>(null);
export const useUpload = () => useContext(UploadContext)!;

const ACCEPT = "video/*,audio/*,.mkv,.m4a,.opus,.amr";
const isMedia = (f: File) => /^(audio|video)\//.test(f.type) || /\.(mkv|m4a|opus|amr|wma|flac)$/i.test(f.name);

export const LANGUAGES = [
  { value: "auto", label: "Detect automatically" },
  { value: "pt", label: "Portuguese" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
];

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((files: File[]) => {
    const media = files.filter(isMedia);
    if (media.length < files.length) toast.error(`${files.length - media.length} file(s) skipped: only audio and video can be processed.`);
    if (media.length) setPending((p) => [...p, ...media]);
  }, []);

  // whole-window drag and drop
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDragging(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  const start = (opts: { title: string; language: string; vocab: string; compress: boolean }) => {
    const files = pending;
    setPending([]);
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0 }]);
      uploadFile(
        file,
        {
          title: files.length === 1 ? opts.title.trim() : undefined,
          language: opts.language === "auto" ? undefined : opts.language,
          vocab: opts.vocab.trim() || undefined,
          compress: opts.compress,
        },
        (progress) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress } : x))),
      )
        .then(() => {
          setUploads((u) => u.filter((x) => x.id !== id));
          qc.invalidateQueries({ queryKey: qk.jobs });
          toast.success(`Uploaded ${file.name}`, { description: "Transcription has started. Follow it under Processing." });
        })
        .catch((err: Error) => {
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: err.message } : x)));
          toast.error(`Couldn't upload ${file.name}`, { description: err.message });
        });
    }
  };

  return (
    <UploadContext.Provider value={{ pickFiles: () => input.current?.click(), addFiles, uploads }}>
      {children}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-playhead px-16 py-12 text-center">
            <p className="text-xl font-semibold">Drop to upload</p>
            <p className="mt-1 text-muted-foreground">Video or audio. Each file becomes a meeting.</p>
          </div>
        </div>
      )}
      <UploadDialog files={pending} onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))} onCancel={() => setPending([])} onStart={start} />
    </UploadContext.Provider>
  );
}

function UploadDialog({
  files, onRemove, onCancel, onStart,
}: {
  files: File[];
  onRemove: (i: number) => void;
  onCancel: () => void;
  onStart: (o: { title: string; language: string; vocab: string; compress: boolean }) => void;
}) {
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("auto");
  const [vocab, setVocab] = useState("");
  const [compress, setCompress] = useState(true);
  const hasVideo = files.some((f) => f.type.startsWith("video/") || /\.(mkv|mov|mp4|webm)$/i.test(f.name));
  const single = files.length === 1;

  useEffect(() => {
    if (single) setTitle(files[0].name.replace(/\.[^.]+$/, "").replace(/^\s*20\d\d[-_.]?\d\d[-_.]?\d\d[\s_-]*/, ""));
  }, [single, files]);

  return (
    <Dialog open={files.length > 0} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{single ? "Upload recording" : `Upload ${files.length} recordings`}</DialogTitle>
          <DialogDescription>Transcription runs on this Mac. Notes are written by Claude when it finishes.</DialogDescription>
        </DialogHeader>

        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm">
              {f.type.startsWith("video/") ? <FileVideo className="size-4 shrink-0 text-muted-foreground" /> : <FileAudio className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="tabular text-muted-foreground">{bytes(f.size)}</span>
              {!single && (
                <button className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`}>
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="grid gap-4">
          {single && (
            <div className="grid gap-1.5">
              <Label htmlFor="up-title">Title</Label>
              <Input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly sync" />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Spoken language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="up-vocab">Names and terms</Label>
            <Input id="up-vocab" value={vocab} onChange={(e) => setVocab(e.target.value)} placeholder="Jumpad, Kubernetes, Ana Souza" />
            <p className="text-xs text-muted-foreground">Helps the transcription spell people, products and jargon correctly.</p>
          </div>
          {hasVideo && (
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox checked={compress} onCheckedChange={(v) => setCompress(v === true)} className="mt-0.5" />
              <span>
                Shrink video to 720p
                <span className="block text-xs text-muted-foreground">Uses about a tenth of the disk space. Keeps the original quality when off.</span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onStart({ title, language, vocab, compress })}>
            {single ? "Upload and transcribe" : `Upload ${files.length} and transcribe`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
