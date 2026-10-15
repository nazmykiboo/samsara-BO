import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card } from "../components/ui/Card";
// Konten diambil LANGSUNG dari docs/panduan-ops.md (root monorepo, di luar apps/web) lewat raw
// import Vite -- SENGAJA tidak disalin ke apps/web supaya tidak ada dua sumber kebenaran yang bisa
// kadaluarsa sendiri-sendiri. Kalau raw import ini error di browser, kemungkinan `server.fs.allow`
// di apps/web/vite.config.ts belum mengizinkan root monorepo (lihat komentar di file itu) -- dan
// dev server Vite perlu di-restart manual setelah config itu diubah (tidak auto-reload).
import panduanMd from "../../../../docs/panduan-ops.md?raw";

interface Section {
  title: string;
  /** Baris markdown milik section ini, termasuk baris heading "## ..." itu sendiri. */
  body: string;
}

/** Pecah markdown jadi section berdasarkan heading level-2 ("## ...") -- apa pun sebelum heading
 * pertama (judul dokumen + catatan pembuka) masuk sebagai "pendahuluan". Heading level-3 ("### ...")
 * ke bawah TIDAK dipecah lagi, tetap dirender apa adanya di dalam section induknya. */
function parseSections(markdown: string): { pendahuluan: string; sections: Section[] } {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let pendahuluan: string[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const match = /^##\s+(.+)$/.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { title: match[1].replace(/\(#.*\)/g, "").trim(), body: line + "\n" };
    } else if (current) {
      current.body += line + "\n";
    } else {
      pendahuluan.push(line);
    }
  }
  if (current) sections.push(current);

  return { pendahuluan: pendahuluan.join("\n"), sections };
}

export function PanduanPage() {
  const { pendahuluan, sections } = useMemo(() => parseSections(panduanMd), []);
  const [activeIdx, setActiveIdx] = useState(0);
  const active = sections[activeIdx];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Panduan Pakai</h1>
        <p className="text-sm text-slate-500">
          Cara pakai Backoffice Samsara sehari-hari, ditulis dengan bahasa sederhana -- tidak perlu
          latar belakang IT untuk mengikutinya.
        </p>
      </div>

      <Card className="prose prose-sm prose-slate max-w-none">
        <Markdown>{pendahuluan}</Markdown>
      </Card>

      <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {sections.map((s, idx) => (
          <button
            key={s.title}
            onClick={() => setActiveIdx(idx)}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              idx === activeIdx ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>

      {active ? (
        <Card className="prose prose-sm prose-slate max-w-none">
          <Markdown>{active.body}</Markdown>
        </Card>
      ) : null}
    </div>
  );
}

/** Render markdown jadi HTML yang rapi (heading, list, tabel, dst tampil sebagai elemen sungguhan --
 * bukan teks mentah dengan tanda # / ** kelihatan). remark-gfm supaya tabel markdown (banyak dipakai
 * di panduan-ops.md, mis. matriks izin per peran) ikut dirender sebagai tabel HTML, bukan diabaikan. */
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ ...props }) => (
          <div className="overflow-x-auto">
            <table {...props} />
          </div>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
