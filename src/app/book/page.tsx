import { BookPanel } from "@/components/BookPanel";
import { AttributedTrades } from "@/components/AttributedTrades";

export default function BookPage() {
  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="type-page">Book</h1>
        <p className="type-lede">Positions, claims, and attributed activity</p>
      </div>
      <BookPanel />
      <AttributedTrades limit={50} />
    </div>
  );
}
