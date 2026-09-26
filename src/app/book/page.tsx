import { BookWorkspace } from "@/components/BookWorkspace";

export default function BookPage() {
  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="type-page">Book</h1>
        <p className="type-lede">
          Positions, claims, and attributed activity · win claims are reported for attribution;
          creator-fee claims are not
        </p>
      </div>
      <BookWorkspace />
    </div>
  );
}
