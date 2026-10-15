import { Card } from "./ui/Card";

/** Halaman ini sengaja belum diisi detail -- menunggu review struktur sebelum dibangun. */
export function PlaceholderPage({ title, rencana }: { title: string; rencana: string[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      <Card>
        <p className="mb-3 text-sm text-slate-500">
          Halaman ini belum diisi detail -- menunggu review struktur. Rencana komponennya:
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
          {rencana.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
