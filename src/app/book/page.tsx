import { BookPanel } from "@/components/BookPanel";

export default function BookPage() {
  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-50">
          Book
        </h1>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Positions & claim builds
        </p>
      </div>
      <BookPanel />
    </div>
  );
}
