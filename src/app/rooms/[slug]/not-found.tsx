import Link from "next/link";
import { EmptyState } from "@/components/ui/States";

export default function RoomNotFound() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <div className="card">
        <EmptyState
          title="Room not found"
          description="There's no Prediction Room at this address. The link may be mistyped, or the room was never created."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/rooms" className="btn btn-secondary">
                Browse rooms
              </Link>
              <Link href="/rooms/create" className="btn btn-primary">
                Create a room
              </Link>
            </div>
          }
        />
      </div>
    </div>
  );
}
