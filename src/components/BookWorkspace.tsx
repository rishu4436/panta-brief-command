"use client";

import { useState } from "react";
import { AttributedTrades } from "./AttributedTrades";
import { BookPanel } from "./BookPanel";

/** Book page body: refreshes Activity when a win claim is reported/attributed. */
export function BookWorkspace() {
  const [activityKey, setActivityKey] = useState(0);
  return (
    <>
      <BookPanel onAttributionUpdate={() => setActivityKey((k) => k + 1)} />
      <AttributedTrades limit={50} refreshKey={activityKey} />
    </>
  );
}
