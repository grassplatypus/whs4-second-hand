import { requireAdminPage } from "@/features/admin/guard";
import { DormantRooms } from "@/features/admin/DormantRooms";

export default async function AdminChatRoomsPage() {
  await requireAdminPage();
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-12">
      <DormantRooms />
    </main>
  );
}
